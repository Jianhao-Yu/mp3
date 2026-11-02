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
    validateUserBody
} = require('./helpers');

const router = express.Router();

async function loadPendingTasks(ids, session) {
    if (ids.length === 0) {
        return [];
    }

    const tasks = await Task.find({ _id: { $in: ids } }).session(session);
    const foundIds = new Set(tasks.map((task) => task._id.toString()));
    if (ids.some((id) => !foundIds.has(id))) {
        throw new ApiError(404, 'One or more referenced tasks were not found');
    }
    if (tasks.some((task) => task.completed)) {
        throw new ApiError(400, 'Completed tasks cannot be added to pendingTasks');
    }
    return tasks;
}

async function ensureEmailAvailable(email, excludedId, session) {
    const filter = { email };
    if (excludedId) {
        filter._id = { $ne: excludedId };
    }
    if (await User.exists(filter).session(session)) {
        throw new ApiError(400, 'A user with that email already exists');
    }
}

async function assignTasksToUser(taskIds, user, session) {
    if (taskIds.length === 0) {
        return;
    }

    await User.updateMany(
        { _id: { $ne: user._id } },
        { $pull: { pendingTasks: { $in: taskIds } } },
        { session }
    );
    await Task.updateMany(
        { _id: { $in: taskIds } },
        {
            $set: {
                assignedUser: user._id.toString(),
                assignedUserName: user.name
            }
        },
        { session }
    );
}

router.get('/', async function (req, res) {
    const options = collectionQueryOptions(req.query);

    if (options.count) {
        const count = await User.countDocuments(options.where);
        return sendOk(res, count);
    }

    let query = User.find(options.where)
        .sort(options.sort)
        .select(options.select)
        .skip(options.skip);
    if (options.limit !== undefined) {
        query = query.limit(options.limit);
    }

    return sendOk(res, await query.exec());
});

router.post('/', async function (req, res) {
    const input = validateUserBody(req.body);

    const createdUser = await inTransaction(async (session) => {
        await ensureEmailAvailable(input.email, null, session);
        await loadPendingTasks(input.pendingTasks, session);

        const [user] = await User.create([input], { session });
        await assignTasksToUser(input.pendingTasks, user, session);
        return user;
    });

    return sendOk(res, createdUser, 'User created', 201);
});

router.get('/:id', async function (req, res) {
    if (!isValidObjectId(req.params.id)) {
        throw new ApiError(404, 'User not found');
    }

    const user = await User.findById(req.params.id).select(singleSelect(req.query));
    if (!user) {
        throw new ApiError(404, 'User not found');
    }
    return sendOk(res, user);
});

router.put('/:id', async function (req, res) {
    if (!isValidObjectId(req.params.id)) {
        throw new ApiError(404, 'User not found');
    }

    const updatedUser = await inTransaction(async (session) => {
        const user = await User.findById(req.params.id).session(session);
        if (!user) {
            throw new ApiError(404, 'User not found');
        }

        const input = validateUserBody(req.body);
        await ensureEmailAvailable(input.email, user._id, session);
        await loadPendingTasks(input.pendingTasks, session);

        const oldTaskIds = user.pendingTasks.map(String);
        const newTaskSet = new Set(input.pendingTasks);
        const removedTaskIds = oldTaskIds.filter((id) => !newTaskSet.has(id));

        await Task.updateMany(
            { assignedUser: user._id.toString() },
            { $set: { assignedUserName: input.name } },
            { session }
        );

        if (removedTaskIds.length > 0) {
            await Task.updateMany(
                {
                    _id: { $in: removedTaskIds },
                    assignedUser: user._id.toString()
                },
                {
                    $set: {
                        assignedUser: '',
                        assignedUserName: 'unassigned'
                    }
                },
                { session }
            );
        }

        user.name = input.name;
        user.email = input.email;
        user.pendingTasks = input.pendingTasks;
        await user.save({ session });

        await assignTasksToUser(input.pendingTasks, user, session);
        return user;
    });

    return sendOk(res, updatedUser, 'User updated');
});

router.delete('/:id', async function (req, res) {
    if (!isValidObjectId(req.params.id)) {
        throw new ApiError(404, 'User not found');
    }

    const deletedUser = await inTransaction(async (session) => {
        const user = await User.findById(req.params.id).session(session);
        if (!user) {
            throw new ApiError(404, 'User not found');
        }

        await Task.updateMany(
            { assignedUser: user._id.toString() },
            {
                $set: {
                    assignedUser: '',
                    assignedUserName: 'unassigned'
                }
            },
            { session }
        );
        await User.deleteOne({ _id: user._id }, { session });
        return user;
    });

    return sendOk(res, deletedUser, 'User deleted');
});

module.exports = router;
