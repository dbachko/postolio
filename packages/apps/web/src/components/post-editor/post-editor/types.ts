export type PostEditorLayout = 'sidebar' | 'page';

export type PostEditorProps = {
  id?: string;
  layout?: PostEditorLayout;
  showHeader?: boolean;
  onRequestClose?: () => void;
};
