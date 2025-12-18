import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Sparkles, Target, Calendar, TrendingUp, Lightbulb } from 'lucide-react';

interface LoadingMessage {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}

const loadingSteps: LoadingMessage[] = [
  {
    icon: Target,
    title: 'Analyzing your campaign goals',
    description: 'Understanding what you want to achieve with this campaign',
  },
  {
    icon: Lightbulb,
    title: 'Crafting content pillars',
    description: 'Creating strategic themes that align with your brand voice',
  },
  {
    icon: Calendar,
    title: 'Building posting schedule',
    description: 'Optimizing timing and frequency for maximum engagement',
  },
  {
    icon: TrendingUp,
    title: 'Forecasting performance',
    description: 'Calculating expected reach and engagement metrics',
  },
  {
    icon: Sparkles,
    title: 'Finalizing your strategy',
    description: 'Putting the finishing touches on your campaign plan',
  },
];

export function GeneratingStrategyLoader() {
  const [currentStep, setCurrentStep] = useState(0);
  const [fadeIn, setFadeIn] = useState(true);

  useEffect(() => {
    // Cycle through messages every 3 seconds
    const interval = setInterval(() => {
      setFadeIn(false);

      // Wait for fade out, then change message and fade in
      setTimeout(() => {
        setCurrentStep((prev) => (prev + 1) % loadingSteps.length);
        setFadeIn(true);
      }, 300);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const currentMessage = loadingSteps[currentStep];
  const Icon = currentMessage.icon;

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="py-8">
        <div className="flex flex-col items-center space-y-6 text-center">
          {/* Main spinning loader */}
          <div className="relative">
            <Loader2 className="text-primary h-12 w-12 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Sparkles className="text-primary h-6 w-6 animate-pulse" />
            </div>
          </div>

          {/* Main title */}
          <div>
            <h3 className="text-lg font-semibold">Generating Your AI Strategy</h3>
            <p className="text-muted-foreground mt-1 text-sm">This will take just a moment...</p>
          </div>

          {/* Animated message with icon */}
          <div
            className={`flex min-h-[80px] items-start gap-3 transition-opacity duration-300 ${
              fadeIn ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <div className="bg-primary/10 text-primary mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full">
              <Icon className="h-4 w-4" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-medium">{currentMessage.title}</p>
              <p className="text-muted-foreground mt-1 text-sm">{currentMessage.description}</p>
            </div>
          </div>

          {/* Progress dots */}
          <div className="flex gap-2">
            {loadingSteps.map((_, index) => {
              let dotClassName = 'bg-muted';
              if (index === currentStep) dotClassName = 'bg-primary w-6';
              else if (index < currentStep) dotClassName = 'bg-primary/40';

              return (
                <div
                  key={index}
                  className={`h-1.5 w-1.5 rounded-full transition-all duration-300 ${dotClassName}`}
                />
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
