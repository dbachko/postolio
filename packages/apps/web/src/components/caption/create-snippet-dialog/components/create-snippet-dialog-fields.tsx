import { X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import type { SnippetFormState } from '../types';

function TitleField(props: {
  title: string;
  setTitle: (title: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="title">
        Title <span className="text-destructive">*</span>
      </Label>
      <Input
        id="title"
        placeholder="e.g., Product Launch CTA, Weekend Hashtags"
        value={props.title}
        onChange={(event) => props.setTitle(event.target.value)}
        maxLength={100}
        disabled={props.disabled}
        autoFocus
      />
      <p className="text-muted-foreground text-xs">
        A descriptive name for this snippet ({props.title.length}/100)
      </p>
    </div>
  );
}

function ContentField(props: {
  content: string;
  setContent: (content: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="content">
        Content <span className="text-destructive">*</span>
      </Label>
      <Textarea
        id="content"
        placeholder="Type or paste your snippet text here..."
        value={props.content}
        onChange={(event) => props.setContent(event.target.value)}
        className="min-h-[150px]"
        maxLength={2000}
        disabled={props.disabled}
      />
      <p className="text-muted-foreground text-xs">
        The text that will be inserted ({props.content.length}/2000)
      </p>
    </div>
  );
}

function TagsField(props: {
  tags: string[];
  tagInput: string;
  setTagInput: (value: string) => void;
  addTag: () => void;
  removeTag: (tag: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="tags">Tags (optional)</Label>
      <div className="flex gap-2">
        <Input
          id="tags"
          placeholder="Add tag (e.g., cta, promo, hashtags)"
          value={props.tagInput}
          onChange={(event) => props.setTagInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              props.addTag();
            }
          }}
          disabled={props.disabled}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={props.addTag}
          disabled={!props.tagInput.trim() || props.disabled}
        >
          Add
        </Button>
      </div>
      {props.tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {props.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
              <button
                type="button"
                onClick={() => props.removeTag(tag)}
                className="hover:text-destructive ml-1"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CategoryField(props: {
  category: string;
  setCategory: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="category">Category (optional)</Label>
      <Input
        id="category"
        placeholder="e.g., CTA, Hashtags, Openers"
        value={props.category}
        onChange={(event) => props.setCategory(event.target.value)}
        maxLength={50}
        disabled={props.disabled}
      />
      <p className="text-muted-foreground text-xs">Group similar snippets together</p>
    </div>
  );
}

function FavoriteField(props: {
  isFavorite: boolean;
  setIsFavorite: (isFavorite: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center space-x-2">
      <Checkbox
        id="favorite"
        checked={props.isFavorite}
        onCheckedChange={(checked) => props.setIsFavorite(checked === true)}
        disabled={props.disabled}
      />
      <label
        htmlFor="favorite"
        className="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
      >
        Mark as favorite
      </label>
    </div>
  );
}

export function SnippetFormFields(props: {
  form: SnippetFormState;
  setForm: (next: SnippetFormState) => void;
  tagInput: string;
  setTagInput: (value: string) => void;
  addTag: () => void;
  removeTag: (tag: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-4 py-4">
      <TitleField
        title={props.form.title}
        setTitle={(title) => props.setForm({ ...props.form, title })}
        disabled={props.disabled}
      />
      <ContentField
        content={props.form.content}
        setContent={(content) => props.setForm({ ...props.form, content })}
        disabled={props.disabled}
      />
      <TagsField
        tags={props.form.tags}
        tagInput={props.tagInput}
        setTagInput={props.setTagInput}
        addTag={props.addTag}
        removeTag={props.removeTag}
        disabled={props.disabled}
      />
      <CategoryField
        category={props.form.category}
        setCategory={(category) => props.setForm({ ...props.form, category })}
        disabled={props.disabled}
      />
      <FavoriteField
        isFavorite={props.form.isFavorite}
        setIsFavorite={(isFavorite) => props.setForm({ ...props.form, isFavorite })}
        disabled={props.disabled}
      />
    </div>
  );
}
