type BrandLoaderProps = {
  size?: "small" | "medium" | "large";
  label?: string;
};

const sizes = {
  small: "size-5",
  medium: "size-12",
  large: "size-20",
};

export function BrandLoader({ size = "medium", label = "Loading Dil Ki Baat" }: BrandLoaderProps) {
  return (
    <span role="status" aria-label={label} className="inline-flex items-center justify-center">
      <img
        src="/dil-ki-baat-mark.png"
        alt=""
        aria-hidden="true"
        className={`${sizes[size]} brand-loader rounded-xl object-contain`}
      />
    </span>
  );
}
