import { Link } from "wouter";
import { PiArrowLeft, PiNewspaperClipping } from "react-icons/pi";

export default function NotFound() {
  return (
    <main className="not-found">
      <PiNewspaperClipping aria-hidden="true" />
      <p>Page not found</p>
      <h1>This page is outside the publication feed.</h1>
      <Link href="/">
        <PiArrowLeft aria-hidden="true" />
        Return to updates
      </Link>
    </main>
  );
}
