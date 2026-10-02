"use client";

import WhyteLoader, {
  WhyteLoaderProps,
  WhyteFullScreenLoader,
  WhyteContentLoader,
} from "./WhyteLoader";

export default function GlobalPageLoader(props: WhyteLoaderProps) {
  return <WhyteLoader {...props} />;
}

export { WhyteFullScreenLoader, WhyteContentLoader };
