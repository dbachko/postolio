import { TemplateCaptionSection } from './components/template-caption-section';
import { TemplateContentTypeSelector } from './components/template-content-type-selector';
import { TemplateMediaSection } from './components/template-media-section';
import { useContentGroupTemplateContentType } from './hooks/use-content-group-template-content-type';
import type { ContentGroupTemplateEditorProps } from './types';

export function ContentGroupTemplateEditor({
  brandId,
  platforms,
  value,
  onChange,
  firstCommentOpen,
  onFirstCommentOpenChange,
  onOpenAssetPicker,
}: ContentGroupTemplateEditorProps) {
  const contentType = useContentGroupTemplateContentType({
    platforms,
    value,
    onChange,
  });

  return (
    <div className="space-y-4">
      <TemplateContentTypeSelector
        value={value}
        disabled={contentType.selectedPlatformsLength === 0}
        allowedContentTypes={contentType.allowedContentTypes}
        onValueChange={contentType.handleContentTypeChange}
      />

      <TemplateMediaSection
        brandId={brandId}
        value={value}
        allowMixedMedia={contentType.allowMixedMedia}
        onChange={onChange}
        onOpenAssetPicker={onOpenAssetPicker}
      />

      <TemplateCaptionSection
        brandId={brandId}
        value={value}
        firstCommentOpen={firstCommentOpen}
        onFirstCommentOpenChange={onFirstCommentOpenChange}
        onChange={onChange}
      />
    </div>
  );
}
