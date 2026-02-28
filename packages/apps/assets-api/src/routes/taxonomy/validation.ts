import type {
  ArchiveBody,
  DeleteTaxonomyBody,
  MergeLabelsBody,
  UpdateTaxonomyBody,
} from './types.js';

export function validateTaxonomyUpdate(
  existing: { brandId: string; isSystem: boolean; type: string },
  body: UpdateTaxonomyBody
): { statusCode: number; message: string } | null {
  if (body.brandId && existing.brandId !== body.brandId) {
    return { statusCode: 403, message: 'Taxonomy item does not belong to brand' };
  }

  if (existing.isSystem && body.createdBy !== 'system') {
    return { statusCode: 403, message: 'System labels are read-only' };
  }

  if (existing.type === 'LABEL' && body.parentId) {
    return { statusCode: 400, message: 'Labels cannot be moved into collections' };
  }

  return null;
}

export function validateDeleteRequest(
  existing: { brandId: string; type: string; isSystem: boolean; _count: { children: number } },
  body: DeleteTaxonomyBody
): { statusCode: number; message: string } | null {
  if (body.brandId && existing.brandId !== body.brandId) {
    return { statusCode: 403, message: 'Taxonomy item does not belong to brand' };
  }

  if (existing.type === 'LABEL' && existing.isSystem && body.createdBy !== 'system') {
    return { statusCode: 403, message: 'System labels are read-only' };
  }

  if (existing.type === 'COLLECTION' && existing._count.children > 0) {
    return {
      statusCode: 400,
      message: 'Collection has subcollections. Move or delete them first.',
    };
  }

  return null;
}

export function validateArchiveRequest(
  label: { type: string; brandId: string; isSystem: boolean } | null,
  body: ArchiveBody
): { statusCode: number; message: string } | null {
  if (!label) {
    return { statusCode: 404, message: 'Label not found' };
  }

  if (label.type !== 'LABEL') {
    return { statusCode: 400, message: 'Only labels can be archived' };
  }

  if (body.brandId && label.brandId !== body.brandId) {
    return { statusCode: 403, message: 'Label does not belong to brand' };
  }

  if (label.isSystem && body.createdBy !== 'system') {
    return { statusCode: 403, message: 'System labels are read-only' };
  }

  return null;
}

export function validateMergeRequest(body: MergeLabelsBody): string | null {
  if (!body.brandId || !body.fromLabelId || !body.intoLabelId) {
    return 'brandId, fromLabelId, and intoLabelId are required';
  }

  if (body.fromLabelId === body.intoLabelId) {
    return 'fromLabelId and intoLabelId must differ';
  }

  return null;
}

export function validateMergeLabelsRelation(
  fromLabel: { id: string; brandId: string; type: string; isSystem: boolean } | null,
  intoLabel: { id: string; brandId: string; type: string } | null,
  body: MergeLabelsBody
): { statusCode: number; message: string } | null {
  if (!fromLabel || !intoLabel) {
    return { statusCode: 404, message: 'Label not found' };
  }

  if (fromLabel.brandId !== body.brandId || intoLabel.brandId !== body.brandId) {
    return { statusCode: 403, message: 'Labels do not belong to brand' };
  }

  if (fromLabel.type !== 'LABEL' || intoLabel.type !== 'LABEL') {
    return { statusCode: 400, message: 'Both items must be labels' };
  }

  if (fromLabel.isSystem && body.createdBy !== 'system') {
    return { statusCode: 403, message: 'System labels are read-only' };
  }

  return null;
}
