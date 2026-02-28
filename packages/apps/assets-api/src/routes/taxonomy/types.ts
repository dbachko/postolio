export type TreeNode<T extends { id: string; parentId?: string | null }> = T & {
  children: Array<TreeNode<T>>;
};

export type CollectionWithCount = TreeNode<{
  id: string;
  parentId?: string | null;
  assetCount?: number;
}>;

export interface ListTaxonomyQuery {
  brandId?: string;
  type?: 'COLLECTION' | 'LABEL';
  format?: 'tree' | 'flat';
  includeArchived?: string;
}

export interface CreateTaxonomyBody {
  brandId: string;
  type: 'COLLECTION' | 'LABEL';
  name: string;
  parentId?: string | null;
  color?: string;
  sortOrder?: number;
  isSystem?: boolean;
  createdBy?: string;
}

export interface UpdateTaxonomyBody {
  brandId?: string;
  name?: string;
  parentId?: string | null;
  sortOrder?: number;
  color?: string;
  createdBy?: string;
}

export interface DeleteTaxonomyBody {
  brandId?: string;
  onNotEmpty?: 'move_to_parent' | 'move_to_unsorted';
  createdBy?: string;
}

export interface ArchiveBody {
  brandId?: string;
  createdBy?: string;
}

export interface MergeLabelsBody {
  brandId: string;
  fromLabelId: string;
  intoLabelId: string;
  createdBy?: string;
}
