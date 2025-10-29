import { Link } from 'react-router-dom';

export function SiteFooter() {
  return (
    <footer className="bg-card mt-8 border-t">
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
        <div className="text-muted-foreground flex flex-col items-center justify-between space-y-3 text-sm md:flex-row md:space-y-0">
          <div className="text-center md:text-left">
            © {new Date().getFullYear()} Postolio. All rights reserved.
          </div>
          <div className="flex items-center gap-1 text-xs md:text-sm">
            <Link
              to="/privacy-policy"
              className="hover:text-foreground hover:bg-accent rounded px-2 py-1 transition-colors"
            >
              Privacy Policy
            </Link>
            <span className="text-muted-foreground/50">•</span>
            <Link
              to="/terms-of-service"
              className="hover:text-foreground hover:bg-accent rounded px-2 py-1 transition-colors"
            >
              Terms of Service
            </Link>
            <span className="text-muted-foreground/50">•</span>
            <Link
              to="/legal/data-deletion"
              className="hover:text-foreground hover:bg-accent rounded px-2 py-1 transition-colors"
            >
              Data Deletion
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
