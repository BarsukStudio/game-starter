import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Reviewed CAS configuration script 2.2 with scalar linker-flag normalization.
// Never download executable latest code
// during a build. The SDK's configuration data keeps its normal 12-hour cache.
const scriptHash = '64e2a77c3dd2dbd3ec97c0ed384109a70d223000de959f382b5d73066b4223c8';
const root = process.cwd();
const ios = path.join(root, 'ios/App');
const script = path.join(ios, 'casconfig.rb');
const seed = path.join(root, 'native/ios/casconfig.rb');
const config = fs.readFileSync(path.join(root, 'src/js/platform/config.js'), 'utf8');
// Like the runtime-target marker, release configuration requires a literal.
// Fail if the consumer changes its shape rather than guessing an app ID.
const id = config.match(/cas:\s*\{[\s\S]*?ios:\s*\{\s*casId:\s*(['"])(\d+)\1\s*\}/)?.[2];
if (!id) throw new Error('CAS iOS preparation requires a numeric literal ads.cas.ios.casId.');
if (!fs.existsSync(path.join(ios, 'App.xcodeproj/project.pbxproj'))) {
  throw new Error('CAS iOS preparation requires ios/App/App.xcodeproj.');
}
const source = fs.existsSync(script) ? script : seed;
if (!fs.existsSync(source) || createHash('sha256').update(fs.readFileSync(source)).digest('hex') !== scriptHash) {
  throw new Error('CAS iOS preparation requires the reviewed casconfig.rb 2.2 seed; review script updates explicitly.');
}
if (source !== script) fs.copyFileSync(source, script);
const env = { ...process.env };
delete env.PROJECT_FILE_PATH; // This is preparation, outside an Xcode build phase.
const output = execFileSync('ruby', [script, id, '--project=App.xcodeproj'], {
  cwd: ios, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
process.stdout.write(output);
// The vendor script has early exits that can return zero. Success requires its
// completed configuration path and footer, followed by verification on disk.
if (!/Config file (?:has been (?:updated|created)|is up-to-date)/.test(output)
  || !/configuration script version 2\.2/.test(output)) {
  throw new Error('CAS iOS configuration did not complete; release stopped.');
}
execFileSync('ruby', ['-e', `
  require 'xcodeproj'
  require 'json'
  project = Xcodeproj::Project.open(ARGV[0])
  target = project.targets.find { |item| item.name == 'App' }
  abort 'CAS: App target missing' unless target
  plist = Xcodeproj::Plist.read_from_path('App/Info.plist')
  abort 'CAS: configured app ID differs from game config' unless plist['CASAIAppIdentifier'].to_s == ARGV[1]
  abort 'CAS: SKAdNetwork configuration missing' unless plist['SKAdNetworkItems'].is_a?(Array) && !plist['SKAdNetworkItems'].empty?
  resources = target.resources_build_phase.files.select { |item| item.file_ref&.path.to_s.match?(/\\Acas_settings.*\\.json\\z/) }
  abort 'CAS: configuration resource missing or ambiguous' unless resources.any? && resources.map { |item| item.file_ref.real_path }.uniq.length == 1
  # The vendor script adds a new file reference whenever its 12-hour cache expires.
  resources.drop(1).each do |item|
    ref = item.file_ref
    item.remove_from_project
    ref.remove_from_project unless ref == resources.first.file_ref
  end
  project.save if resources.length > 1
  file = resources.first.file_ref.real_path
  abort 'CAS: configuration resource missing or stale' unless file.file? && Time.now - file.mtime <= 43200
  config = JSON.parse(file.read)
  abort 'CAS: configuration resource empty' unless config.is_a?(Hash) && !config.empty?
  gad = config['admob_app_id']
  abort 'CAS: Google Ads app ID differs from downloaded CAS settings' unless gad.to_s.match?(/\\Aca-app-pub-\\d+~\\d+\\z/) && plist['GADApplicationIdentifier'] == gad
  puts 'CAS iOS configuration and Xcode resource verified.'
`, 'App.xcodeproj', id], { cwd: ios, env, stdio: 'inherit' });
