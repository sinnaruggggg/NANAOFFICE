const path = require('node:path');
const { execFileSync } = require('node:child_process');

function signingOptions(env) {
  const { NANAOFFICE_SIGNING_CERT_SHA1:thumbprint, NANAOFFICE_SIGNING_AZURE_ENDPOINT:endpoint,
    NANAOFFICE_SIGNING_AZURE_ACCOUNT:codeSigningAccountName,
    NANAOFFICE_SIGNING_AZURE_PROFILE:certificateProfileName,
    NANAOFFICE_SIGNING_AZURE_PUBLISHER:publisherName } = env;
  const azure = {endpoint,codeSigningAccountName,certificateProfileName,publisherName};
  if (Object.values(azure).some(Boolean)) {
    if (Object.values(azure).some(value => !value)) {
      throw Error('Azure 서명 계정, 인증서 프로필, 게시자 이름과 서비스 주소를 모두 설정하세요.');
    }
    return {azureSignOptions:azure};
  }
  if (thumbprint && !/^[0-9a-f]{40}$/i.test(thumbprint)) {
    throw Error('Windows 코드 서명 인증서 지문 형식을 확인하세요.');
  }
  if (!thumbprint && !env.WIN_CSC_LINK && !env.CSC_LINK) {
    throw Error('신뢰할 수 있는 Windows 코드 서명 인증서 또는 서명 서비스 연결이 필요합니다.');
  }
  return {signtoolOptions:{signingHashAlgorithms:['sha256'],...(thumbprint ? {certificateSha1:thumbprint} : {})}};
}

async function main() {
  if (process.platform !== 'win32') throw Error('Windows에서 서명 빌드를 실행하세요.');
  const signing = signingOptions(process.env);
  const project = path.resolve(__dirname,'..');
  execFileSync(process.execPath,[path.join(__dirname,'stage-office.cjs')],{stdio:'inherit'});
  const { Arch, Platform, build } = require('electron-builder');
  const artifacts = await build({
    projectDir:project,
    targets:Platform.WINDOWS.createTarget('msi',Arch.x64),
    publish:'never',
    config:{
      extends:path.join(project,'electron-builder.yml'),
      forceCodeSigning:true,
      win:{...signing,signExts:['.dll','.node']},
    },
  });
  const installer = artifacts.find(file => file.toLowerCase().endsWith('.msi'));
  if (!installer) throw Error('서명된 MSI를 찾을 수 없습니다.');
  const executableDir = path.join(project,'release','win-unpacked');
  const powershell = path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  execFileSync(powershell,['-NoProfile','-File',path.join(__dirname,'verify-windows-signatures.ps1'),
    '-Installer',installer,'-AppDirectory',executableDir],{stdio:'inherit',windowsHide:true});
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
