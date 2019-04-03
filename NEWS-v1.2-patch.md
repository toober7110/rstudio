
## RStudio v1.2 Patch

### Bug Fixes

- Fix pane configuration being reset after customization (#2101)
- Fix issue where middle click failed to close editor tabs (#4379)
- Fix incorrect application of C++ project compilation options to non-project files (#4404)
- Fix issues on MacOS with command line tool headers when `/usr/include` is missing (#4405)
- Fix issue where attempts to run R debugger in .Rprofile could hang RStudio (#4443)
- Fix parsing multi-line expressions with single brackets inside strings (#4452)
- Improve detection of remote sessions on Windows (#4466)
- Fix issue where text in prompts would fail to display on macOS Mojave (#4497)
- Fix "Reload App" button for Shiny applications in Firefox on RStudio Server (#4552)
- Fix issue where themes without names would not use the file name as a name instead (#4553)