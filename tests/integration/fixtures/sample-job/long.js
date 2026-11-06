'use strict';

// 真实 Job 示例：长时运行（用于工作台 Job 取消路径测试）。
console.log('job-long: started, will run for 60s');
setInterval(() => {
  console.log('job-long: still running');
}, 5000);
