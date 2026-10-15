# Changelog

Every release of the LocatorZero desktop app. The web app at locatorzero.pages.dev always runs the latest.
The app shows the same list under menu → About → **What's new in this version**.

## 0.3.0 (October 2026): get deleted files back, and find things faster

- **Recycle Bin search, with Restore** (Search in → Recycle Bin, or Trash): type part of a name and see what you
  deleted, when, and the folder it came from. An empty search lists the most recently deleted first. **Restore** puts
  an item back where it was after you confirm, and never overwrites: if something with that name is there now, it
  stops and says so. Two separate OKs: one to look in the bin, one for each restore. Only your own bin is read, with no
  administrator rights. Windows and Linux; on macOS it finds items and Finder's Put Back restores them.
- **Deleted by mistake?** (menu): what to do when a file skipped the bin (Shift+Delete, emptied bin), for Windows,
  macOS and Linux: backups, recovery tools, cloud bins. Text only, nothing is scanned.
- **Kind chips with counts** above the results, a **Modified** picker, and **Group** by type, place or folder.
- **Search tricks**: `ext:pdf`, `ext:jpg,png`, `size:>10mb`, `size:<1kb`, `modified:today|yesterday|week|month|year|30d`,
  `type:image|document|sheet|video|code|archive|folder|web`, mixed with any words.
- **Connected places** (desktop menu): every drive, USB stick, network and cloud folder, with free space, size and file
  system. The same details show in the Search in menu.
- **Ctrl Shift Space** (⌘ Shift Space on a Mac) brings LocatorZero to the front from any app, ready to type.
- The browser version says plainly, under the search field, that it sees only the demo computer or a folder you pick.
- The web app has a made-up Recycle Bin, so the Restore flow can be tried without installing anything.

## 0.2.0 (October 2026): Clean up, free up space safely

- **Clean up** (menu → Clean up): finds files stored more than once, and the biggest files, in a place you choose,
  in seconds.
- See them as a list, or on a **map** of every folder that holds a copy. Green stays, red goes.
- **Tick all extra copies** in one click. One copy of every file always stays.
- Nothing moves until you confirm. Each copy is checked byte for byte first, then goes to the Recycle Bin or Trash,
  so it can be restored.
- **About** and **What's new** in the menu: your version, and what changed. After an update, What's new opens once.
- Welcome tour: a new slide about Clean up, with a shortcut to it on the first slide.

## 0.1.0 (October 2026): first release

- One search across your computer, drives, cloud folders, browser history, open tabs and running apps.
- Locations and Map views, Preview, Show in folder, light and dark themes.
- Private by design: no internet connection, nothing kept, consent before each place.
- 90-day free trial and offline licence keys.
