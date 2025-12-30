import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

export function AppFooter() {
  return (
    <footer className={cn('bg-card fixed right-0 bottom-0 left-0 z-30 border-t', 'md:left-[52px]')}>
      <div className="px-4 py-2 sm:px-6 lg:px-8">
        <div className="text-muted-foreground flex w-full flex-col items-center justify-center space-y-1 text-xs md:flex-row md:space-y-0 md:text-sm">
          <div className="flex w-full flex-wrap items-center justify-center gap-1 text-xs md:justify-end md:text-sm">
            <Link
              to="/limits"
              className="hover:text-foreground hover:bg-accent rounded px-2 py-0.5 transition-colors"
            >
              Limits & Plans
            </Link>
            <span className="text-muted-foreground/50">•</span>
            <Link
              to="/privacy-policy"
              className="hover:text-foreground hover:bg-accent rounded px-2 py-0.5 transition-colors"
            >
              Privacy Policy
            </Link>
            <span className="text-muted-foreground/50">•</span>
            <Link
              to="/terms-of-service"
              className="hover:text-foreground hover:bg-accent rounded px-2 py-0.5 transition-colors"
            >
              Terms of Service
            </Link>
            <span className="text-muted-foreground/50">•</span>
            <Link
              to="/legal/data-deletion"
              className="hover:text-foreground hover:bg-accent rounded px-2 py-0.5 transition-colors"
            >
              Data Deletion
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
