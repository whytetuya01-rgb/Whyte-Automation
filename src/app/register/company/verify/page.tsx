import { Suspense } from "react";
import VerifyEmailView from "./VerifyEmailView";

export const metadata = {
  title: "Verify your email | Whyte Automation",
};

/** Opened from the verification email. The token is read from the link and sent to the server once. */
export default function VerifyCompanyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailView />
    </Suspense>
  );
}
