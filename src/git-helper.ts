import { execSync } from 'child_process';

try {
  console.log("=== GIT LOG FOR STOCKCOUNT ===\n");
  const log = execSync('git log -n 15 --oneline -- src/pages/StockCountPage.tsx', { encoding: 'utf8' });
  console.log(log);

  console.log("\n=== GIT DIFF FROM PREVIOUS WORKING VERSION ===\n");
  // Let's find a commit before the recent refactoring/regression.
  // We can see the commits first, then we can run diff.
} catch (err: any) {
  console.error("Error executing git:", err.message);
}
