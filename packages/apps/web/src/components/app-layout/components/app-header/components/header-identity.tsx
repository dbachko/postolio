import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

export type HeaderBreadcrumb = { label: string; to?: string };

function HeaderBreadcrumbTrail({ items }: { items: HeaderBreadcrumb[] }) {
  return (
    <Breadcrumb>
      <BreadcrumbList className="text-foreground gap-1 text-sm font-semibold">
        {items.map((item, index) => (
          <Fragment key={`${item.label}-${index}`}>
            {index > 0 ? <BreadcrumbSeparator /> : null}
            <BreadcrumbItem>
              {item.to ? (
                <BreadcrumbLink asChild className="text-muted-foreground hover:text-foreground">
                  <Link to={item.to}>{item.label}</Link>
                </BreadcrumbLink>
              ) : (
                <span className="text-foreground">{item.label}</span>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function HeaderIdentity({
  headerBreadcrumbs,
  title,
  description,
}: {
  headerBreadcrumbs: HeaderBreadcrumb[] | null;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Link
        to="/dashboard"
        className="flex items-center space-x-2 md:hidden"
        aria-label="Postolio home"
      >
        <img src="/postolio-icon.svg" alt="" className="h-7 w-7" aria-hidden="true" />
        <h1 className="text-foreground text-lg font-bold">Postolio</h1>
      </Link>
      <div className="hidden min-w-0 flex-col md:flex">
        {headerBreadcrumbs ? (
          <HeaderBreadcrumbTrail items={headerBreadcrumbs} />
        ) : (
          <h1 className="text-foreground truncate text-sm font-semibold">{title}</h1>
        )}
        {description ? (
          <p className="text-muted-foreground truncate text-xs">{description}</p>
        ) : null}
      </div>
    </div>
  );
}
