export type FileTreeNode =
  | { type: 'file'; name: string; path: string }
  | { type: 'folder'; name: string; path: string; children: FileTreeNode[] }
