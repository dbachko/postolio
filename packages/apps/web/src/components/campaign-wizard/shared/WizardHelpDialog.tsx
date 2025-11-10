import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../ui/dialog';
import { type ReactNode } from 'react';

interface WizardHelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentStep?: number;
}

const stepHelpContent: Record<number, { title: string; content: ReactNode }> = {
  1: {
    title: 'Campaign Type',
    content: (
      <div className="text-foreground space-y-4 text-sm leading-6">
        <p>
          Select the type of campaign that best matches your goals. This helps us tailor the content
          strategy and recommendations.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Promotional:</strong> Focus on product launches, sales, or special offers
          </li>
          <li>
            <strong>Educational:</strong> Share knowledge, tutorials, and how-to content
          </li>
          <li>
            <strong>Seasonal:</strong> Align with holidays, events, or seasonal trends
          </li>
          <li>
            <strong>Thought Leadership:</strong> Position your brand as an industry expert
          </li>
          <li>
            <strong>Custom:</strong> Create a unique campaign with specific goals
          </li>
        </ul>
        <p className="text-muted-foreground text-xs italic">
          Don't worry - you can always adjust your strategy later in the wizard.
        </p>
      </div>
    ),
  },
  2: {
    title: 'Goals & Timeline',
    content: (
      <div className="text-foreground space-y-4 text-sm leading-6">
        <section>
          <h4 className="mb-2 font-semibold">Campaign Goals</h4>
          <p>Define what you want to achieve with this campaign:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Be specific about desired outcomes (e.g., "Increase product awareness")</li>
            <li>You can add multiple goals - they'll guide content generation</li>
            <li>Use the AI suggestion feature for goal ideas based on your brand</li>
          </ul>
        </section>
        <section>
          <h4 className="mb-2 font-semibold">Timeline & Schedule</h4>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Start/End Date:</strong> Campaign duration affects content volume and pacing
            </li>
            <li>
              <strong>Posting Frequency:</strong> How often to publish (daily, every 2 days, 3x
              weekly)
            </li>
            <li>
              <strong>Posting Time:</strong> Optimal time for your audience engagement
            </li>
          </ul>
        </section>
      </div>
    ),
  },
  3: {
    title: 'Content Themes',
    content: (
      <div className="text-foreground space-y-4 text-sm leading-6">
        <p>
          Themes are the specific topics your campaign will cover. They guide what content gets
          created.
        </p>
        <section>
          <h4 className="mb-2 font-semibold">How to Choose Themes</h4>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Suggested Themes:</strong> Click any suggested theme to add it - they're
              ranked by relevance to your brand
            </li>
            <li>
              <strong>Performance Boost:</strong> Themes with a trending icon (↗) have shown better
              engagement
            </li>
            <li>
              <strong>Accept Top:</strong> Quickly add the top 5 suggested themes
            </li>
            <li>
              <strong>Clear:</strong> Clear selected themes
            </li>
            <li>
              <strong>Custom Themes:</strong> Add your own specific topics below
            </li>
          </ul>
        </section>
        <p className="text-muted-foreground text-xs italic">
          Tip: At least one theme is required to continue. Mix suggested and custom themes for best
          results.
        </p>
      </div>
    ),
  },
  4: {
    title: 'Image Preferences',
    content: (
      <div className="text-foreground space-y-4 text-sm leading-6">
        <p>Define the visual style for AI-generated images in your campaign.</p>
        <section>
          <h4 className="mb-2 font-semibold">Visual Style Options</h4>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Brand Analysis:</strong> If you've run brand analysis, we'll suggest styles
              based on your successful posts
            </li>
            <li>
              <strong>Custom Style:</strong> Describe your preferred visual aesthetic (e.g.,
              "minimalist product photography", "vibrant lifestyle shots")
            </li>
            <li>
              <strong>Style Consistency:</strong> Your selected style applies to all AI-generated
              images in the campaign
            </li>
          </ul>
        </section>
        <p className="text-muted-foreground text-xs italic">
          Note: You can still upload your own images or edit individual posts later.
        </p>
      </div>
    ),
  },
  5: {
    title: 'AI Strategy',
    content: (
      <div className="text-foreground space-y-4 text-sm leading-6">
        <p>AI generates a complete content strategy based on your goals, themes, and brand data.</p>
        <section>
          <h4 className="mb-2 font-semibold">Content Pillars</h4>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Pillars are the 3-5 core topic categories that organize your content (e.g.,
              "Education", "Product Features", "Community")
            </li>
            <li>
              Percentages show how much of your content focuses on each pillar (must total 100%)
            </li>
            <li>You can add, remove, or adjust pillar names and percentages</li>
          </ul>
        </section>
        <section>
          <h4 className="mb-2 font-semibold">Posting Schedule</h4>
          <p>
            Shows the multi-phase posting strategy with different frequencies for campaign phases
            (e.g., ramp-up, peak, wind-down)
          </p>
        </section>
        <section>
          <h4 className="mb-2 font-semibold">Forecast</h4>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>From Data:</strong> Based on your actual Instagram performance
            </li>
            <li>
              <strong>Heuristic:</strong> Industry benchmarks (connect Instagram for better
              accuracy)
            </li>
          </ul>
        </section>
      </div>
    ),
  },
  6: {
    title: 'Timeline Review',
    content: (
      <div className="text-foreground space-y-4 text-sm leading-6">
        <p>Review and finalize your campaign schedule and settings.</p>
        <section>
          <h4 className="mb-2 font-semibold">What to Check</h4>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Timeline:</strong> Verify start and end dates align with your campaign goals
            </li>
            <li>
              <strong>Posting Frequency:</strong> Adjust if you want more or fewer posts
            </li>
            <li>
              <strong>Posting Time:</strong> Change to match when your audience is most active
            </li>
            <li>
              <strong>Content Pillars:</strong> Last chance to adjust topic distribution
            </li>
          </ul>
        </section>
        <p className="text-muted-foreground text-xs italic">
          These settings determine how many posts will be generated and when they'll be scheduled.
        </p>
      </div>
    ),
  },
  7: {
    title: 'Final Review',
    content: (
      <div className="text-foreground space-y-4 text-sm leading-6">
        <p>
          Review your complete campaign setup before launching. This is your last chance to make
          changes.
        </p>
        <section>
          <h4 className="mb-2 font-semibold">What Happens Next</h4>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Content Generation:</strong> AI will create posts based on your themes,
              pillars, and style
            </li>
            <li>
              <strong>Scheduling:</strong> Posts will be scheduled according to your timeline and
              frequency
            </li>
            <li>
              <strong>Review & Edit:</strong> You can review, edit, and approve posts before they're
              published
            </li>
            <li>
              <strong>Publishing:</strong> Approved posts will publish automatically to Instagram at
              scheduled times
            </li>
          </ul>
        </section>
        <p className="text-muted-foreground mt-4 text-xs italic">
          Missing required fields? The launch button will show you what needs to be completed.
        </p>
      </div>
    ),
  },
};

export function WizardHelpDialog({ open, onOpenChange, currentStep = 1 }: WizardHelpDialogProps) {
  const helpContent = stepHelpContent[currentStep] || stepHelpContent[1];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Step {currentStep}: {helpContent.title}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto pr-2">{helpContent.content}</div>
      </DialogContent>
    </Dialog>
  );
}
