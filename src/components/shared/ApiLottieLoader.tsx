"use client";

import ApiLoadingOverlay, { ApiLoadingOverlayProps } from "./ApiLoadingOverlay";

export type ApiLottieLoaderProps = ApiLoadingOverlayProps & {
  isVisible?: boolean;
};

export default function ApiLottieLoader({
  isVisible,
  loading,
  ...props
}: ApiLottieLoaderProps) {
  return (
    <ApiLoadingOverlay
      loading={loading !== undefined ? loading : !!isVisible}
      {...props}
    />
  );
}

export { ApiLoadingOverlay };
