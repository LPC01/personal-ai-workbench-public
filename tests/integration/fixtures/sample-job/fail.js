'use strict';

// 真实 Job 示例：失败退出（用于工作台 Job 失败路径测试）。
console.error('job-fail: something went wrong');
process.exit(2);
