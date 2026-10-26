import SubmittedView from "./SubmittedView";

export const metadata = {
  title: "Registration submitted | Whyte Automation",
};

/**
 * Confirmation shown after a company registration. It receives and shows nothing about the submission (no ids,
 * emails or passwords), so a reload or a shared link is harmless. The owner is not signed in.
 */
export default function CompanyRegistrationSubmittedPage() {
  return <SubmittedView />;
}
