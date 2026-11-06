import { openConnection, runMigrations, migrations, RunStore } from '@workbench/persistence';
import { buildApp } from './app.js';
import { resolveDataDir } from './data-dir.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3000);
const dataDirConfig = resolveDataDir(process.env);
const DB_PATH = dataDirConfig.dbPath;
const ARTIFACTS_ROOT = dataDirConfig.artifactsPath;

const db = openConnection({ path: DB_PATH });
runMigrations(db, migrations);

// Host 启动对账（26 SPEC §11）：把上次异常退出遗留的非终态 Run 收敛到终态
const reconciled = new RunStore(db).reconcileOnStartup();
if (reconciled.length > 0) {
  console.log(`reconciled ${reconciled.length} stale run(s) on startup`);
}

const app = buildApp(db, { artifactsRoot: ARTIFACTS_ROOT, dataDirConfig });

app
  .listen({ host: HOST, port: PORT })
  .then(() => {
    console.log(`workbench server listening on http://${HOST}:${PORT}`);
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
