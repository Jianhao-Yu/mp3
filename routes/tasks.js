const express = require('express');

const Task = require('../models/task');
const User = require('../models/user');
const {
    ApiError,
    collectionQueryOptions,
    inTransaction,
    isValidObjectId,
    sendOk,
    singleSelect,
    validateTaskBody
} = require('./helpers');

const router = express.Router();

async function resolveAssignment(input, session) {
    if (input.assignedUser === '') {
        return 'unassigned';
    }

    const user = await User.findById(input.assignedUser).session(session);
    if (!user) {
        throw new ApiError(404, 'Assigned user not found');
    }
    if (input.assignedUserName !== undefined && input.assignedUserName !== user.name) {
        throw new ApiError(400, 'assignedUserName does not match the assigned user');
    }
    return user.name;
}

async function syncUserPendingTask(taskId, newUserId, completed, session) {
    await User.updateMany(
        { pendingTasks: taskId.toString() },
        { $pull: { pendingTasks: taskId.toString() } },
        { session }
    );

    if (newUserId !== '' && !completed) {
        await User.updateOne(
            { _id: newUserId },
            { $addToSet: { pendingTasks: taskId.toString() } },
            { session }
        );
    }
}

router.get('/', async function (req, res) {
    const options = collectionQueryOptions(req.query, 100);

    if (options.count) {
        const count = await Task.countDocuments(options.where);
        return sendOk(res, count);
    }

    const tasks = await Task.find(options.where)
        .sort(options.sort)
        .select(options.select)
        .skip(options.skip)
        .limit(options.limit)
        .exec();
    return sendOk(res, tasks);
});

router.post('/', async function (req, res) {
    const input = validateTaskBody(req.body);

    const createdTask = await inTransaction(async (session) => {
        input.assignedUserName = await resolveAssignment(input, session);
        const [task] = await Task.create([input], { session });
        await syncUserPendingTask(task._id, task.assignedUser, task.completed, session);
        return task;
    });

    return sendOk(res, createdTask, 'Task created', 201);
});

router.get('/:id', async function (req, res) {
    if (!isValidObjectId(req.params.id)) {
        throw new ApiError(404, 'Task not found');
    }

    const task = await Task.findById(req.params.id).select(singleSelect(req.query));
    if (!task) {
        throw new ApiError(404, 'Task not found');
    }
    return sendOk(res, task);
});

router.put('/:id', async function (req, res) {
    if (!isValidObjectId(req.params.id)) {
        throw new ApiError(404, 'Task not found');
    }

    const updatedTask = await inTransaction(async (session) => {
        const task = await Task.findById(req.params.id).session(session);
        if (!task) {
            throw new ApiError(404, 'Task not found');
        }

        const input = validateTaskBody(req.body);
        input.assignedUserName = await resolveAssignment(input, session);
        task.name = input.name;
        task.description = input.description;
        task.deadline = input.deadline;
        task.completed = input.completed;
        task.assignedUser = input.assignedUser;
        task.assignedUserName = input.assignedUserName;
        await task.save({ session });

        await syncUserPendingTask(
            task._id,
            task.assignedUser,
            task.completed,
            session
        );
        return task;
    });

    return sendOk(res, updatedTask, 'Task updated');
});

router.delete('/:id', async function (req, res) {
    if (!isValidObjectId(req.params.id)) {
        throw new ApiError(404, 'Task not found');
    }

    const deletedTask = await inTransaction(async (session) => {
        const task = await Task.findById(req.params.id).session(session);
        if (!task) {
            throw new ApiError(404, 'Task not found');
        }

        await User.updateMany(
            { pendingTasks: task._id.toString() },
            { $pull: { pendingTasks: task._id.toString() } },
            { session }
        );
        await Task.deleteOne({ _id: task._id }, { session });
        return task;
    });

    return sendOk(res, deletedTask, 'Task deleted');
});

module.exports = router;
