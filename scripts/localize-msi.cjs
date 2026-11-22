const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

exports.default = async function localizeMsi(projectFile) {
  let project = await readFile(projectFile,'utf8');
  const replacements = [
    ['Language="1033"','Language="1042"'],
    ['<Package Compressed="yes" InstallerVersion="500"/>',
      '<Package Compressed="yes" InstallerVersion="500" Languages="1042"/>'],
    ['Windows 7 and above is required','Windows 7 이상이 필요합니다.'],
    ['<MajorUpgrade AllowSameVersionUpgrades="yes"',
      '<MajorUpgrade IgnoreLanguage="yes" AllowSameVersionUpgrades="yes"'],
    ['A newer version of "[ProductName]" is already installed.','[ProductName]의 더 최신 버전이 이미 설치되어 있습니다.'],
    ['<UIRef Id="WixUI_InstallDir"/>',[
      '<WixVariable Id="WixUILicenseRtf" Value="nana-installation-ko.rtf"/>',
      '<UIRef Id="WixUI_InstallDir"/>',
      '<UIRef Id="WixUI_ErrorProgressText"/>',
    ].join('\n      ')],
  ];
  for (const [before,after] of replacements) {
    if (!project.includes(before)) throw Error('설치 마법사의 한국어 설정을 적용할 수 없습니다.');
    project = project.replace(before,after);
  }
  const guide = 'NANAOFFICE 설치 안내\n설치 마법사의 안내에 따라 설치를 진행하세요.';
  const rtf = [...guide].map(letter => {
    if (letter === '\n') return '\\par ';
    const value = letter.charCodeAt(0);
    return value < 128 ? letter : '\\u' + (value > 32767 ? value - 65536 : value) + '?';
  }).join('');
  await writeFile(path.join(path.dirname(projectFile),'nana-installation-ko.rtf'),
    '{\\rtf1\\ansi\\ansicpg949\\deff0\\deflang1042{\\fonttbl{\\f0\\fnil Malgun Gothic;}}\\uc1\\f0\\fs22 ' + rtf + '}');
  await writeFile(projectFile,project,'utf8');
};
