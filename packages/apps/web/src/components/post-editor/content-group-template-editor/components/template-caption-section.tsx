import { MessageSquareText } from 'lucide-react';

import { PostCaptionEditor } from '@/components/post-caption-editor';
import { CheckSwitch } from '@/components/ui/check-switch';
import { Label } from '@/components/ui/label';

import type { ContentGroupTemplateFormState } from '../types';

interface TemplateCaptionSectionProps {
  brandId: string;
  value: ContentGroupTemplateFormState;
  firstCommentOpen: boolean;
  onFirstCommentOpenChange: (open: boolean) => void;
  onChange: (
    updater: (prev: ContentGroupTemplateFormState) => ContentGroupTemplateFormState
  ) => void;
}

export function TemplateCaptionSection(props: TemplateCaptionSectionProps) {
  if (props.value.contentType === 'story') {
    return null;
  }

  return (
    <>
      <PostCaptionEditor
        value={props.value.caption}
        onChange={(caption) => props.onChange((state) => ({ ...state, caption }))}
        brandId={props.brandId}
        disabled={false}
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
            id="template-first-comment-toggle"
            checked={props.firstCommentOpen}
            onCheckedChange={props.onFirstCommentOpenChange}
          />
        </div>
        {props.firstCommentOpen ? (
          <PostCaptionEditor
            id="template-firstComment"
            hideLabel={true}
            value={props.value.firstComment || ''}
            onChange={(firstComment) => props.onChange((state) => ({ ...state, firstComment }))}
            brandId={props.brandId}
            placeholder="Write a caption with text, links..."
            minHeight="min-h-24"
            maxLength={2200}
            disabled={false}
            showIcon={false}
          />
        ) : null}
      </div>
    </>
  );
}
