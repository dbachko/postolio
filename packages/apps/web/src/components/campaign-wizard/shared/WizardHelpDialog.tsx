import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../ui/dialog';

interface WizardHelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WizardHelpDialog({ open, onOpenChange }: WizardHelpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Campaign Wizard Help</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto pr-2">
          <div className="space-y-6 text-sm leading-6 text-gray-800">
            <section>
              <h3 className="mb-2 text-base font-semibold">Content Pillars</h3>
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  Pillars are the 3–5 core topic categories your campaign will consistently cover.
                </li>
                <li>
                  Each pillar has a name, an optional set of example themes, and a percentage that
                  represents how much of your total posts should focus on that pillar (percentages
                  must total 100).
                </li>
                <li>
                  They guide the mix of content across the campaign: the generator and schedule use
                  them to balance topics, vary prompts/hashtags, and maintain voice consistency.
                </li>
                <li>
                  Difference from “Themes”: pillars are the big buckets (e.g., “Education”), while
                  themes are specific topics inside a pillar (e.g., “How‑tos”, “Tips”). The wizard
                  can flatten pillar themes into the campaign’s theme list when you “Apply All”.
                </li>
                <li>
                  Good pattern: tie pillars to goals, keep 3–5, and distribute weight meaningfully
                  (e.g., Awareness 40%, Product Education 40%, Community/Social Proof 20%).
                </li>
              </ul>
            </section>

            <section>
              <h3 className="mb-2 text-base font-semibold">Analyze Goal</h3>
              <ul className="list-disc space-y-2 pl-5">
                <li>Turns your goal text into a structured brief.</li>
                <li>Inputs: brand + goal (optionally themes/type).</li>
                <li>
                  Outputs: objectives, key messages, audience/risk hints, suggested content pillars
                  with percentages, and a high‑level cadence suggestion.
                </li>
                <li>
                  Action: Opens a review; click “Apply Suggestions” to adopt pillars (and
                  frequency). No schedule phases or predictions.
                </li>
              </ul>
            </section>

            <section>
              <h3 className="mb-2 text-base font-semibold">Generate With AI</h3>
              <ul className="list-disc space-y-2 pl-5">
                <li>Builds a full campaign strategy from your brief.</li>
                <li>
                  Requires: timeline (start/end), frequency, posting time (style is optional;
                  defaults to “modern”).
                </li>
                <li>
                  Outputs: normalized pillars, multi‑phase posting schedule (phases + posting time),
                  forecasts (estimated posts, reach range, engagement rate), and recommendations.
                </li>
                <li>
                  Action: Populates the Step 3 panels; “Apply All” updates posting time, frequency,
                  and merges pillar themes into your wizard themes.
                </li>
              </ul>
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
