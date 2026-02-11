import { backgroundJobs, JobType } from '../background-jobs.js';

export async function enqueueRecipeRun(runId: string): Promise<void> {
  await backgroundJobs.scheduleJob(
    JobType.RECIPE_RUN_EXECUTE,
    { runId },
    {
      jobId: `recipe-run:${runId}`,
      attempts: 1,
      removeOnComplete: 500,
      removeOnFail: 500,
    }
  );
}
