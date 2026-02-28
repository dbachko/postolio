import { CircleFadingPlus, Film, Image as ImageIcon } from 'lucide-react';

import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

import type { ContentGroupTemplateFormState } from '../types';

interface TemplateContentTypeSelectorProps {
  value: ContentGroupTemplateFormState;
  disabled: boolean;
  allowedContentTypes: { post: boolean; reel: boolean; story: boolean };
  onValueChange: (next: string) => void;
}

function ContentTypeItem(props: {
  id: string;
  value: 'post' | 'reel' | 'story';
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
}) {
  return (
    <div className="flex-1">
      <RadioGroupItem
        value={props.value}
        id={props.id}
        className="peer sr-only"
        disabled={props.disabled}
      />
      <Label
        htmlFor={props.id}
        className="hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-accent/50 border-input bg-background flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 text-xs transition-all peer-disabled:pointer-events-none peer-disabled:opacity-50 sm:text-sm"
      >
        {props.icon}
        <span>{props.label}</span>
      </Label>
    </div>
  );
}

export function TemplateContentTypeSelector(props: TemplateContentTypeSelectorProps) {
  return (
    <div className="space-y-2">
      <Label className="text-sm">
        Content Type <span className="text-destructive">*</span>
      </Label>
      <RadioGroup
        value={props.value.contentType}
        onValueChange={props.onValueChange}
        className="flex gap-2"
        disabled={props.disabled}
      >
        <ContentTypeItem
          id="template-type-post"
          value="post"
          label="Post"
          icon={<ImageIcon className="h-3.5 w-3.5" />}
          disabled={!props.allowedContentTypes.post}
        />
        <ContentTypeItem
          id="template-type-reel"
          value="reel"
          label="Reel"
          icon={<Film className="h-3.5 w-3.5" />}
          disabled={!props.allowedContentTypes.reel}
        />
        <ContentTypeItem
          id="template-type-story"
          value="story"
          label="Story"
          icon={<CircleFadingPlus className="h-3.5 w-3.5" />}
          disabled={!props.allowedContentTypes.story}
        />
      </RadioGroup>
    </div>
  );
}
