const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const mongoose = require('mongoose');

const { app } = require('../server');

const databaseUri = process.env.TEST_MONGODB_URI;

function isSafeLocalTestDatabase(uri) {
    if (!uri) {
        return false;
    }
    try {
        const parsed = new URL(uri);
        const isLocal = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
        return isLocal && parsed.pathname.endsWith('_test');
    } catch (_error) {
        return false;
    }
}

const canRunIntegrationTests = isSafeLocalTestDatabase(databaseUri);
let baseUrl;
let server;

async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
            'content-type': 'application/json',
            ...(options.headers || {})
        }
    });
    const body = await response.json();
    return { response, body };
}

before(async () => {
    if (!canRunIntegrationTests) {
        return;
    }
    await mongoose.connect(databaseUri);
    await mongoose.connection.dropDatabase();
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (!canRunIntegrationTests) {
        return;
    }
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
});

test('CRUD, validation, queries, and two-way references stay consistent', {
    skip: !canRunIntegrationTests
}, async () => {
    let result = await request('/api/users', {
        method: 'POST',
        body: JSON.stringify({ name: 'No Email' })
    });
    assert.equal(result.response.status, 400);
    assert.deepEqual(Object.keys(result.body).sort(), ['data', 'message']);

    result = await request('/api/users', {
        method: 'POST',
        body: JSON.stringify({ name: 'Ada', email: 'ada@example.com' })
    });
    assert.equal(result.response.status, 201);
    const ada = result.body.data;
    assert.deepEqual(ada.pendingTasks, []);
    assert.ok(ada.dateCreated);

    result = await request('/api/users', {
        method: 'POST',
        body: JSON.stringify({ name: 'Ada Again', email: 'ada@example.com' })
    });
    assert.equal(result.response.status, 400);

    result = await request('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Write tests',
            deadline: '2027-01-02T12:00:00.000Z',
            assignedUser: ada._id
        })
    });
    assert.equal(result.response.status, 201);
    const task = result.body.data;
    assert.equal(task.assignedUserName, 'Ada');
    assert.equal(task.completed, false);

    result = await request(`/api/users/${ada._id}`);
    assert.deepEqual(result.body.data.pendingTasks, [task._id]);

    const originalTaskDate = task.dateCreated;
    result = await request(`/api/tasks/${task._id}`, {
        method: 'PUT',
        body: JSON.stringify({
            name: 'Write tests',
            deadline: '2027-01-03T12:00:00.000Z',
            completed: true,
            assignedUser: ada._id,
            assignedUserName: 'Ada'
        })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.dateCreated, originalTaskDate);

    result = await request(`/api/users/${ada._id}`);
    assert.deepEqual(result.body.data.pendingTasks, []);

    result = await request('/api/users', {
        method: 'POST',
        body: JSON.stringify({ name: 'Grace', email: 'grace@example.com' })
    });
    const grace = result.body.data;

    result = await request(`/api/users/${grace._id}`, {
        method: 'PUT',
        body: JSON.stringify({
            name: 'Grace Hopper',
            email: 'grace@example.com',
            pendingTasks: [task._id]
        })
    });
    assert.equal(result.response.status, 400, 'completed tasks cannot enter pendingTasks');
    assert.equal(result.body.message, 'Completed tasks cannot be added to pendingTasks');

    result = await request(`/api/users/${grace._id}`);
    assert.equal(result.body.data.name, 'Grace', 'failed request was rolled back');

    result = await request(`/api/tasks/${task._id}`, {
        method: 'PUT',
        body: JSON.stringify({
            name: 'Write tests',
            deadline: '2027-01-03T12:00:00.000Z',
            completed: false,
            assignedUser: ada._id
        })
    });
    assert.equal(result.response.status, 200);

    result = await request(`/api/users/${grace._id}`, {
        method: 'PUT',
        body: JSON.stringify({
            name: 'Grace Hopper',
            email: 'grace@example.com',
            pendingTasks: [task._id]
        })
    });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.data.pendingTasks, [task._id]);

    result = await request(`/api/users/${ada._id}`);
    assert.deepEqual(result.body.data.pendingTasks, []);
    result = await request(`/api/tasks/${task._id}`);
    assert.equal(result.body.data.assignedUser, grace._id);
    assert.equal(result.body.data.assignedUserName, 'Grace Hopper');

    result = await request(`/api/tasks/${task._id}?select=${encodeURIComponent(JSON.stringify({ name: 1, _id: 0 }))}`);
    assert.deepEqual(result.body.data, { name: 'Write tests' });

    result = await request(`/api/tasks?where=${encodeURIComponent(JSON.stringify({ completed: false }))}&sort=${encodeURIComponent(JSON.stringify({ name: 1 }))}&limit=1&count=true`);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data, 1);

    result = await request('/api/tasks?where=not-json');
    assert.equal(result.response.status, 400);

    result = await request('/api/users/not-an-object-id');
    assert.equal(result.response.status, 404);

    result = await request('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Completed work',
            deadline: '2027-02-01T12:00:00.000Z',
            completed: true,
            assignedUser: grace._id
        })
    });
    assert.equal(result.response.status, 201);
    const completedTask = result.body.data;

    result = await request(`/api/users/${grace._id}`, {
        method: 'PUT',
        body: JSON.stringify({
            name: 'Amazing Grace',
            email: 'grace@example.com',
            pendingTasks: [task._id]
        })
    });
    assert.equal(result.response.status, 200);
    result = await request(`/api/tasks/${completedTask._id}`);
    assert.equal(result.body.data.assignedUserName, 'Amazing Grace');

    result = await request(`/api/users/${grace._id}`, { method: 'DELETE' });
    assert.equal(result.response.status, 200);
    result = await request(`/api/tasks/${task._id}`);
    assert.equal(result.body.data.assignedUser, '');
    assert.equal(result.body.data.assignedUserName, 'unassigned');
    result = await request(`/api/tasks/${completedTask._id}`);
    assert.equal(result.body.data.assignedUser, '');

    result = await request(`/api/tasks/${task._id}`, { method: 'DELETE' });
    assert.equal(result.response.status, 200);
    result = await request(`/api/users/${grace._id}`);
    assert.equal(result.response.status, 404);

    result = await request('/api/users', {
        method: 'POST',
        body: JSON.stringify({ name: 'Lin', email: 'lin@example.com' })
    });
    const lin = result.body.data;
    result = await request('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Temporary task',
            deadline: '2027-03-01T12:00:00.000Z',
            assignedUser: lin._id
        })
    });
    const temporaryTask = result.body.data;
    result = await request(`/api/tasks/${temporaryTask._id}`, { method: 'DELETE' });
    assert.equal(result.response.status, 200);
    result = await request(`/api/users/${lin._id}`);
    assert.deepEqual(result.body.data.pendingTasks, []);
});
