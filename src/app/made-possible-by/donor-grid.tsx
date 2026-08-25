type DonorRow = {
  id: string;
  displayName: string | null;
  tributeName: string | null;
  displayMode: string;
};

export function DonorGrid({ donors }: { donors: DonorRow[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {donors.map((d) => (
        <span key={d.id} className="text-ink text-base">
          {d.displayMode === "TRIBUTE" ? d.tributeName : d.displayName}
        </span>
      ))}
    </div>
  );
}
