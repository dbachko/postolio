import { MessageSquareText } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { CheckSwitch } from '@/components/ui/check-switch';
import { PostCaptionEditor } from '@/components/post-caption-editor';
import type { InstagramContentType } from '@postolio/content-validation';

interface CaptionAndFirstCommentProps {
  mode: 'create' | 'edit';
  contentType: InstagramContentType;
  caption: string;
  firstComment: string;
  firstCommentOpen: boolean;
  onFirstCommentOpenChange: (open: boolean) => void;
  onCaptionChange: (value: string) => void;
  onFirstCommentChange: (value: string) => void;
  brandId?: string;
  disabled: boolean;
}

export function CaptionAndFirstComment({
  mode,
  contentType,
  caption,
  firstComment,
  firstCommentOpen,
  onFirstCommentOpenChange,
  onCaptionChange,
  onFirstCommentChange,
  brandId,
  disabled,
}: CaptionAndFirstCommentProps) {
  if (contentType === 'story') return null;

  return (
    <>
      <PostCaptionEditor
        value={caption}
        onChange={onCaptionChange}
        brandId={brandId}
        disabled={disabled}
        showIcon={true}
      />

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label className="flex items-center gap-2">
              <MessageSquareText className="h-4 w-4" />
              First comment
            </Label>
            <p className="text-muted-foreground text-xs">Publish a first comment with your post.</p>
          </div>
          <CheckSwitch
            id={mode === 'create' ? 'first-comment-toggle' : 'first-comment-toggle-edit'}
            checked={firstCommentOpen}
            onCheckedChange={onFirstCommentOpenChange}
            disabled={disabled}
          />
        </div>
        {firstCommentOpen ? (
          <PostCaptionEditor
            id={mode === 'create' ? 'firstComment' : 'firstComment-edit'}
            hideLabel={true}
            value={firstComment || ''}
            onChange={onFirstCommentChange}
            brandId={brandId}
            placeholder="Write a caption with text, links..."
            minHeight="min-h-24"
            maxLength={2200}
            disabled={disabled}
            showIcon={false}
          />
        ) : null}
      </div>
    </>
  );
}
