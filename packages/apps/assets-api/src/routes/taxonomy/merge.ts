import { prismaAssets } from '@postolio/database-assets';

export async function mergeLabelAssignments(
  fromLabelId: string,
  intoLabelId: string,
  createdBy: string
): Promise<void> {
  const assignments = await prismaAssets.assetTaxonomyAssignment.findMany({
    where: { taxonomyItemId: fromLabelId },
    select: { assetId: true },
  });

  if (assignments.length > 0) {
    await prismaAssets.assetTaxonomyAssignment.createMany({
      data: assignments.map((assignment) => ({
        assetId: assignment.assetId,
        taxonomyItemId: intoLabelId,
        createdBy,
      })),
      skipDuplicates: true,
    });
  }

  await prismaAssets.assetTaxonomyAssignment.deleteMany({ where: { taxonomyItemId: fromLabelId } });
}
