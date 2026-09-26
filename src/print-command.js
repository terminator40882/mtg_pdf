/**
 * The command shown at the bottom of the page on the Linux target; clicking the block
 * copies exactly this text.
 *
 * The browser always names the download mtg_cards.pdf, so the path is fixed here.
 * Adjust it if the browser saves somewhere other than ~/Downloads.
 * This is the only place to edit when the printer queue or its options change.
 */
export const LINUX_PRINT_COMMAND = `lp -d Canon_G600_series \\
   -o PageSize=89x89mm.Borderless \\
   -o MediaType=Com.canon.mtcardstock \\
   -o cupsPrintQuality=High \\
   -o print-scaling=none \\
   ~/Downloads/mtg_cards.pdf`;
