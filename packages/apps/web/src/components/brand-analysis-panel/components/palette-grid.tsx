type PaletteGridProps = {
  colors: string[];
};

export function PaletteGrid({ colors }: PaletteGridProps) {
  return (
    <div className="mt-2 grid grid-cols-5 gap-3 sm:grid-cols-8">
      {colors.slice(0, 16).map((hex) => (
        <div key={hex} className="flex flex-col items-center">
          <div
            className="h-8 w-8 rounded shadow ring-1 ring-black/5"
            style={{ backgroundColor: hex }}
            title={hex}
          />
          <span className="text-muted-foreground mt-1 text-[10px]">{hex}</span>
        </div>
      ))}
    </div>
  );
}
