const { ApiError } = require('./helpers');

module.exports = function registerRoutes(app) {
    app.use('/api', require('./home'));
    app.use('/api/users', require('./users'));
    app.use('/api/tasks', require('./tasks'));

    app.use(function (_req, _res, next) {
        next(new ApiError(404, 'Endpoint not found'));
    });

    app.use(function errorHandler(error, _req, res, _next) {
        if (error instanceof ApiError) {
            return res.status(error.status).json({
                message: error.message,
                data: error.data
            });
        }

        if (error && error.type === 'entity.parse.failed') {
            return res.status(400).json({
                message: 'Request body contains invalid JSON',
                data: null
            });
        }

        if (error && error.code === 11000) {
            return res.status(400).json({
                message: 'A user with that email already exists',
                data: null
            });
        }

        if (error && (error.name === 'ValidationError' || error.name === 'CastError')) {
            return res.status(400).json({
                message: 'The request contains an invalid value',
                data: null
            });
        }

        console.error('Unexpected server error:', error);
        return res.status(500).json({
            message: 'An unexpected server error occurred',
            data: null
        });
    });
};
