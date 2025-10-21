"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ioredis_1 = require("ioredis");
var redis = new ioredis_1.Redis({
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    host: process.env.REDIS_HOST || 'localhost',
    maxRetriesPerRequest: null, // Recommended for BullMQ
});
redis.on('connect', function () { return console.log('Connected to Redis'); });
redis.on('error', function (err) { return console.error('Redis Client Error', err); });
exports.default = redis;
