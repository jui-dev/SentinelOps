/**
 * What sits behind every modal — a form dialog, the manage-incident drawer,
 * the date-range picker, the navigation drawer: the page, dimmed by the
 * scrim and softly blurred, so the dialog is what the eye lands on. The
 * page stays recognisable behind it, so where the dialog came from is
 * never lost.
 *
 * The scrim already carries its own strength per theme, deeper in dark;
 * the blur is small, enough to quiet the page's text without hiding its
 * shape.
 */
export const MODAL_BACKDROP = "backdrop:bg-scrim backdrop:backdrop-blur-sm";
