'use client';

import * as React from 'react';
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon } from 'lucide-react';
import { type DayButton, DayPicker, getDefaultClassNames } from 'react-day-picker';

import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type CalendarProps = React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>['variant'];
};

type CalendarClassNamesArgs = {
  defaultClassNames: ReturnType<typeof getDefaultClassNames>;
  buttonVariant: React.ComponentProps<typeof Button>['variant'];
  captionLayout: React.ComponentProps<typeof DayPicker>['captionLayout'];
  classNames?: React.ComponentProps<typeof DayPicker>['classNames'];
};

function buildCalendarNavigationClassNames(args: CalendarClassNamesArgs) {
  return {
    nav: cn(
      'absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1',
      args.defaultClassNames.nav
    ),
    button_previous: cn(
      buttonVariants({ variant: args.buttonVariant }),
      'h-[var(--cell-size)] w-[var(--cell-size)] select-none p-0 aria-disabled:opacity-50',
      args.defaultClassNames.button_previous
    ),
    button_next: cn(
      buttonVariants({ variant: args.buttonVariant }),
      'h-[var(--cell-size)] w-[var(--cell-size)] select-none p-0 aria-disabled:opacity-50',
      args.defaultClassNames.button_next
    ),
    month_caption: cn(
      'flex h-[var(--cell-size)] w-full items-center justify-center px-[var(--cell-size)]',
      args.defaultClassNames.month_caption
    ),
    dropdowns: cn(
      'flex h-[var(--cell-size)] w-full items-center justify-center gap-1.5 text-sm font-medium',
      args.defaultClassNames.dropdowns
    ),
    dropdown_root: cn(
      'has-focus:border-ring border-input shadow-xs has-focus:ring-ring/50 has-focus:ring-[3px] relative rounded-md border',
      args.defaultClassNames.dropdown_root
    ),
    dropdown: cn('bg-popover absolute inset-0 opacity-0', args.defaultClassNames.dropdown),
    caption_label: cn(
      'select-none font-medium',
      args.captionLayout === 'label'
        ? 'text-sm'
        : '[&>svg]:text-muted-foreground flex h-8 items-center gap-1 rounded-md pl-2 pr-1 text-sm [&>svg]:size-3.5',
      args.defaultClassNames.caption_label
    ),
  };
}

function buildCalendarDayClassNames(args: CalendarClassNamesArgs) {
  return {
    day: cn(
      'group/day relative h-[var(--cell-size)] w-[var(--cell-size)] select-none p-0 text-center',
      args.defaultClassNames.day
    ),
    day_button: cn(
      'h-[var(--cell-size)] w-[var(--cell-size)] select-none p-0 aria-disabled:opacity-50',
      args.defaultClassNames.day_button
    ),
    range_start: cn('bg-accent rounded-l-md', args.defaultClassNames.range_start),
    range_middle: cn('rounded-none', args.defaultClassNames.range_middle),
    range_end: cn('bg-accent rounded-r-md', args.defaultClassNames.range_end),
    today: cn(
      'bg-accent text-accent-foreground rounded-md data-[selected=true]:rounded-none',
      args.defaultClassNames.today
    ),
    outside: cn(
      'text-muted-foreground aria-selected:text-muted-foreground',
      args.defaultClassNames.outside
    ),
    disabled: cn('text-muted-foreground opacity-50', args.defaultClassNames.disabled),
    hidden: cn('invisible', args.defaultClassNames.hidden),
  };
}

function buildCalendarClassNames(args: CalendarClassNamesArgs) {
  return {
    root: cn('w-fit', args.defaultClassNames.root),
    months: cn('relative flex flex-col gap-4 md:flex-row', args.defaultClassNames.months),
    month: cn('flex w-full flex-col gap-4', args.defaultClassNames.month),
    month_grid: cn('w-full border-collapse', args.defaultClassNames.month_grid),
    weekdays: cn('', args.defaultClassNames.weekdays),
    weekday: cn(
      'text-muted-foreground w-[var(--cell-size)] select-none rounded-md text-[0.8rem] font-normal',
      args.defaultClassNames.weekday
    ),
    weeks: cn('', args.defaultClassNames.weeks),
    week: cn('', args.defaultClassNames.week),
    week_number_header: cn(
      'w-[var(--cell-size)] select-none',
      args.defaultClassNames.week_number_header
    ),
    week_number: cn(
      'text-muted-foreground select-none text-[0.8rem]',
      args.defaultClassNames.week_number
    ),
    ...buildCalendarNavigationClassNames(args),
    ...buildCalendarDayClassNames(args),
    ...args.classNames,
  };
}

function CalendarRoot({
  className,
  rootRef,
  ...props
}: {
  className?: string;
  rootRef?: React.Ref<HTMLDivElement>;
} & React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="calendar" ref={rootRef} className={cn(className)} {...props} />;
}

function CalendarChevron(props: {
  className?: string;
  orientation?: 'up' | 'down' | 'left' | 'right';
  size?: number;
  disabled?: boolean;
}) {
  const { className, orientation } = props;
  if (orientation === 'left') {
    return <ChevronLeftIcon className={cn('size-4', className)} />;
  }

  if (orientation === 'right') {
    return <ChevronRightIcon className={cn('size-4', className)} />;
  }

  if (orientation === 'up') {
    return <ChevronUpIcon className={cn('size-4', className)} />;
  }

  return <ChevronDownIcon className={cn('size-4', className)} />;
}

function CalendarWeekNumber({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td {...props}>
      <div className="flex size-[var(--cell-size)] items-center justify-center text-center">
        {children}
      </div>
    </td>
  );
}

function buildCalendarComponents(
  components: React.ComponentProps<typeof DayPicker>['components'] | undefined
) {
  return {
    Root: CalendarRoot,
    Chevron: CalendarChevron,
    DayButton: CalendarDayButton,
    WeekNumber: CalendarWeekNumber,
    ...components,
  };
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = 'label',
  buttonVariant = 'ghost',
  formatters,
  components,
  ...props
}: CalendarProps) {
  const defaultClassNames = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        'bg-background group/calendar p-3 [--cell-size:2rem] [[data-slot=card-content]_&]:bg-transparent [[data-slot=popover-content]_&]:bg-transparent',
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      )}
      captionLayout={captionLayout}
      formatters={{
        formatMonthDropdown: (date) => date.toLocaleString('default', { month: 'short' }),
        ...formatters,
      }}
      classNames={buildCalendarClassNames({
        defaultClassNames,
        buttonVariant,
        captionLayout,
        classNames,
      })}
      components={buildCalendarComponents(components)}
      {...props}
    />
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const ref = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (modifiers.focused) {
      ref.current?.focus();
    }
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        'data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground data-[range-middle=true]:bg-accent data-[range-middle=true]:text-accent-foreground data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-ring/50 flex flex-col gap-1 leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-[3px] data-[range-end=true]:rounded-md data-[range-middle=true]:rounded-none data-[range-start=true]:rounded-md [&>span]:text-xs [&>span]:opacity-70',
        className
      )}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
