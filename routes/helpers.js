const mongoose = require('mongoose');

class ApiError extends Error {
    constructor(status, message, data = null) {
        super(message);
        this.status = status;
        this.data = data;
    }
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonParameter(query, key, fallback) {
    if (query[key] === undefined) {
        return fallback;
    }

    if (typeof query[key] !== 'string') {
        throw new ApiError(400, `Invalid ${key} query parameter`);
    }

    try {
        return JSON.parse(query[key]);
    } catch (_error) {
        throw new ApiError(400, `Invalid ${key} query parameter`);
    }
}

function parseObjectParameter(query, key, fallback = {}) {
    const value = parseJsonParameter(query, key, fallback);
    if (!isPlainObject(value)) {
        throw new ApiError(400, `The ${key} query parameter must be a JSON object`);
    }
    return value;
}

function parseNonnegativeInteger(query, key, fallback) {
    const value = parseJsonParameter(query, key, fallback);
    if (!Number.isInteger(value) || value < 0) {
        throw new ApiError(400, `The ${key} query parameter must be a nonnegative integer`);
    }
    return value;
}

function collectionQueryOptions(query, defaultLimit) {
    const options = {
        where: parseObjectParameter(query, 'where'),
        sort: parseObjectParameter(query, 'sort'),
        select: parseObjectParameter(query, 'select'),
        skip: parseNonnegativeInteger(query, 'skip', 0),
        count: parseJsonParameter(query, 'count', false)
    };

    if (typeof options.count !== 'boolean') {
        throw new ApiError(400, 'The count query parameter must be true or false');
    }

    if (query.limit !== undefined || defaultLimit !== undefined) {
        options.limit = parseNonnegativeInteger(query, 'limit', defaultLimit);
    }

    return options;
}

function singleSelect(query) {
    return parseObjectParameter(query, 'select');
}

function isValidObjectId(value) {
    return typeof value === 'string' && mongoose.isObjectIdOrHexString(value);
}

function requireNonemptyString(value, field) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new ApiError(400, `${field} is required and must be a nonempty string`);
    }
}

function uniqueStrings(values) {
    const result = [];
    for (const value of values) {
        if (!result.includes(value)) {
            result.push(value);
        }
    }
    return result;
}

function validateUserBody(body) {
    if (!isPlainObject(body)) {
        throw new ApiError(400, 'Request body must be a JSON object');
    }

    requireNonemptyString(body.name, 'name');
    requireNonemptyString(body.email, 'email');

    const pendingTasks = body.pendingTasks === undefined ? [] : body.pendingTasks;
    if (!Array.isArray(pendingTasks)) {
        throw new ApiError(400, 'pendingTasks must be an array');
    }
    if (pendingTasks.some((id) => !isValidObjectId(id))) {
        throw new ApiError(400, 'Every pendingTasks entry must be a valid task id');
    }

    return {
        name: body.name,
        email: body.email,
        pendingTasks: uniqueStrings(pendingTasks)
    };
}

function validateTaskBody(body) {
    if (!isPlainObject(body)) {
        throw new ApiError(400, 'Request body must be a JSON object');
    }

    requireNonemptyString(body.name, 'name');

    if (typeof body.deadline !== 'string' || body.deadline.trim().length === 0 || Number.isNaN(Date.parse(body.deadline))) {
        throw new ApiError(400, 'deadline is required and must be a valid date string');
    }

    if (body.description !== undefined && typeof body.description !== 'string') {
        throw new ApiError(400, 'description must be a string');
    }
    if (body.completed !== undefined && typeof body.completed !== 'boolean') {
        throw new ApiError(400, 'completed must be a boolean');
    }

    const assignedUser = body.assignedUser === undefined ? '' : body.assignedUser;
    if (typeof assignedUser !== 'string' || (assignedUser !== '' && !isValidObjectId(assignedUser))) {
        throw new ApiError(400, 'assignedUser must be empty or a valid user id');
    }
    if (body.assignedUserName !== undefined && typeof body.assignedUserName !== 'string') {
        throw new ApiError(400, 'assignedUserName must be a string');
    }
    if (assignedUser === '' && body.assignedUserName !== undefined && body.assignedUserName !== 'unassigned') {
        throw new ApiError(400, 'An unassigned task must have assignedUserName "unassigned"');
    }

    return {
        name: body.name,
        description: body.description === undefined ? '' : body.description,
        deadline: new Date(body.deadline),
        completed: body.completed === undefined ? false : body.completed,
        assignedUser,
        assignedUserName: body.assignedUserName
    };
}

async function inTransaction(work) {
    const session = await mongoose.startSession();
    let result;
    try {
        await session.withTransaction(async () => {
            result = await work(session);
        });
        return result;
    } finally {
        await session.endSession();
    }
}

function sendOk(res, data, message = 'OK', status = 200) {
    return res.status(status).json({ message, data });
}

module.exports = {
    ApiError,
    collectionQueryOptions,
    inTransaction,
    isValidObjectId,
    sendOk,
    singleSelect,
    validateTaskBody,
    validateUserBody
};
