export const getDynamoDBConfig = () => ({
  schedulesTable: process.env.SCHEDULES_TABLE!,
  campaignsTable: process.env.CAMPAIGNS_TABLE!,
  scheduleGroupName: process.env.SCHEDULER_GROUP_NAME || 'default',
  indexes: {
    brand: {
      name: process.env.SCHEDULES_TABLE_BRAND_INDEX!,
      partitionKey: 'gsi1pk',
      sortKey: 'gsi1sk',
    },
    status: {
      name: process.env.SCHEDULES_TABLE_STATUS_INDEX!,
      partitionKey: 'status',
      sortKey: 'scheduledAt',
    },
    content: {
      name: 'by-content-id',
      partitionKey: 'contentId',
      sortKey: 'scheduledAt',
    },
  },
});

export const SCHEDULE_STATUS = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  FAILED: 'failed',
  SKIPPED: 'skipped',
};

export const formatEventBridgeScheduleTime = (date: string | Date): string => {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  const hour = d.getUTCHours().toString().padStart(2, '0');
  const minute = d.getUTCMinutes().toString().padStart(2, '0');
  const second = d.getUTCSeconds().toString().padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
};
