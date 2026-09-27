/**
 * The command shown at the bottom of the page on the Linux target; clicking the block
 * copies exactly this text.
 *
 * The browser appends -1, -2, ... to a download whose name is already taken, and the
 * page has no way to learn the name it actually used. So the command does not name a
 * file at all: it picks the most recent matching download itself.
 *
 * This is the only place to edit when the printer queue, its options, or the download
 * directory change.
 */

/** Shell expression for the newest mtg_cards PDF in ~/Downloads. */
export const NEWEST_DOWNLOAD = '"$(ls -t ~/Downloads/mtg_cards*.pdf | head -1)"';

export const LINUX_PRINT_COMMAND = `lp -d Canon_G600_series \\
   -o PageSize=89x89mm.Borderless \\
   -o MediaType=Com.canon.mtcardstock \\
   -o cupsPrintQuality=High \\
   -o print-scaling=none \\
   ${NEWEST_DOWNLOAD}`;
