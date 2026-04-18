const fs = require("fs");
const path = require("path");
//console.log(`generateSfdxCommand is path...`);

function getAllFiles(dirPath, extensions, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);

  arrayOfFiles = arrayOfFiles || [];

  files.forEach((file) => {
    const filePath = path.join(dirPath, file);
    if (fs.statSync(filePath).isDirectory()) {
      arrayOfFiles = getAllFiles(filePath, extensions, arrayOfFiles);
    } else {
      // Check if the file extension is in the list of desired extensions
      const fileExt = path.extname(file).toLowerCase();
      // Check if the file name contains 'test' (case-insensitive)
      const fileName = path.basename(file).toLowerCase();
      if (extensions.includes(fileExt) && fileName.includes("test")) {
        arrayOfFiles.push(filePath);
      }
    }
  });

  return arrayOfFiles;
}

// Function to find a file containing a specific string in its name
function findFileNameContainingString(files, searchString) {
  searchString = searchString.toLowerCase();
  return files.find((file) =>
    path.basename(file).toLowerCase().includes(searchString)
  );
}

function getFileName(filePath) {
  let fileNameWithExtension = path.basename(filePath);
  return path.parse(fileNameWithExtension).name;
}

function findSfdxProjectDirOld() {
  let sfdxProjectDir = null;

  fs.readdirSync(".").forEach((file) => {
    if (file === "sfdx-project.json") {
      sfdxProjectDir = path.resolve(file);
      return "./";
    }
    if (fs.statSync(file).isDirectory()) {
      fs.readdirSync(file).forEach((innerFile) => {
        if (innerFile === "sfdx-project.json") {
          sfdxProjectDir = path.dirname(path.resolve(file, innerFile)) + "/";
          return "./";
        }
        return "";
      });
    }
    return "";
  });

  if (sfdxProjectDir === null) {
    return "./";
  } else {
    return sfdxProjectDir;
  }
}

function findSfdxProjectDir() {
  let currentDir = path.resolve(".");

  while (currentDir) {
    // Check if "sfdx-project.json" exists in the current directory
    if (fs.existsSync(path.join(currentDir, "sfdx-project.json"))) {
      return currentDir + "/";
    }

    // Check if "sfdx-project.json" exists in any subdirectory of the current directory
    const files = fs.readdirSync(currentDir);
    for (const file of files) {
      const fullPath = path.join(currentDir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        const innerPath = path.join(fullPath, "sfdx-project.json");
        if (fs.existsSync(innerPath)) {
          return fullPath + "/";
        }
      }
    }

    // Move to the parent directory
    const parentDir = path.resolve(currentDir, "..");
    if (currentDir === parentDir) {
      break; // Stop if we reach the root directory
    }
    currentDir = parentDir;
  }

  // Return "./" if the file is not found anywhere
  return "./";
}

function generateSfdxCommand() {
  //console.log(`generateSfdxCommand is running...`);
  try {
    // Get all the test files in the tests directory
    const directoryPath = findSfdxProjectDir();
    const extensions = [".js", ".cls"]; // Add the file extensions you need
    const files = getAllFiles(directoryPath, extensions);
    // Read the XML file
    const xml = fs.readFileSync("./delta/package/package.xml", "utf8");
    // Regular expression to match the types
    const regex =
      /<types>([\s\S]*?)<name>(.*?)<\/name>[\s\S]*?<\/types>/g;

    // Initialize empty arrays for ApexClass and LightningComponentBundle
    const apexClasses = [];
    let lightningComponentBundles;
    lightningComponentBundles = [];

    // Use the regular expression to extract the types
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const membersBlock = match[1]; // Extracted block of all <members>
      const name = match[2]; // The <name> of the type

      // Extract individual <members> from the block
      const members = membersBlock.match(/<members>(.*?)<\/members>/g) || [];
      const memberNames = members.map(m => m.replace(/<\/?members>/g, ''));

      //console.log(member);
      memberNames.forEach((member) => {
        // Construct the test file path. This depends on your project structure and naming convention.
        const testFilePath = findFileNameContainingString(files, member);

        // Check if the test file exists
        if (testFilePath) {
          if (name === "ApexClass" && testFilePath.includes(".cls")) {
            let fileName = getFileName(testFilePath);
            if (fileName.includes(" ")) {
              fileName = '"' + fileName + '"';
            }
            apexClasses.push(fileName);
          } else if (
            name === "LightningComponentBundle" &&
            testFilePath.includes(".js")
          ) {
            lightningComponentBundles.push(testFilePath);
          }
        }
      });
    }
    //console.log(apexClasses.join(','));
    // Generate the sfdx command to run the tests
    let sfdxCommand = "";
    let sfdxCommandArray = ["--test-level", "RunSpecifiedTests", "--tests"];
    if (apexClasses.length !== 0) {
      sfdxCommandArray = sfdxCommandArray.concat(apexClasses);
      sfdxCommand = sfdxCommandArray.join(" ");
    }
    //const notCoverage = " --skip-code-coverage"
    //sfdxCommand = sfdxCommand + notCoverage;
    //console.log('sfdxCommand log : ' + sfdxCommand);

    return sfdxCommand;
  } catch (error) {
    console.error(`An error occurred: ${error.message}`);
    return "";
  }
}

//console.log(`generateSfdxCommand module.exports running...`);
module.exports = function () {
  const result = generateSfdxCommand();
  console.log(result);
};
