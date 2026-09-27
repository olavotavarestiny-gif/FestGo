import Image from "next/image";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex items-center gap-2.5 ${className}`}
      aria-label="FestGO"
    >
      <span className="flex h-10 w-10 items-center justify-center">
        <Image
          src="/brand/festgo-logo.png"
          alt=""
          width={40}
          height={40}
          className="h-full w-full object-contain"
          priority
        />
      </span>
      <span className="text-[19px] font-black tracking-[-.06em]">
        Fest<span className="text-violet">GO</span>
      </span>
    </div>
  );
}
