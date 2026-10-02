// Must be the first import: lets the data folder be overridden (portable installs, tests)
// before anything reads app.getPath("userData").
import { app } from "electron";

if (process.env.MULTIPOST_USER_DATA) {
  app.setPath("userData", process.env.MULTIPOST_USER_DATA);
}
