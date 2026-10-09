import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { exportTemplate } from '../tools/export-template.mjs';

test('reviewed CAS Ruby accepts scalar and array linker flags without losing quoted flags', t => {
  const ruby = spawnSync('ruby', ['--version'], { encoding: 'utf8' });
  if (ruby.error?.code === 'ENOENT') return t.skip('Ruby is required only for iOS release preparation');
  const source = fs.readFileSync(new URL('../template/variants/cas/native/ios/casconfig.rb', import.meta.url), 'utf8');
  const method = source.match(/        def ensure_ldflags\n([\s\S]*?)\n    end\n\n    class ProjectPlist/)?.[0].replace(/\n    end\n\n    class ProjectPlist$/, '');
  assert.ok(method, 'exercise the vendor method used by real preparation');
  const script = `require 'shellwords'
    require 'json'
    module CASConfig
      def self.success(message); end
    end
    class Subject
      attr_reader :mainTarget
      def initialize(flags)
        @mainTarget = Struct.new(:build_configurations).new(flags.map { |value|
          Struct.new(:build_settings).new({'OTHER_LDFLAGS' => value})
        })
      end
      ${method}
    end
    subject = Subject.new([nil, '$(inherited)', '-framework "My Framework" $(inherited)', ['-ObjC', '$(inherited)', '-framework', 'Existing']])
    subject.ensure_ldflags
    puts JSON.generate(subject.mainTarget.build_configurations.map { |item| item.build_settings['OTHER_LDFLAGS'] })`;
  const result = spawnSync('ruby', ['-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    ['$(inherited)', '-ObjC'], ['-ObjC', '$(inherited)'],
    ['-ObjC', '-framework', 'My Framework', '$(inherited)'],
    ['-ObjC', '$(inherited)', '-framework', 'Existing'],
  ]);
});

// The native integration check needs Ruby/xcodeproj, which the iOS preparation
// already requires. Keep the plain Node contract suite usable on other hosts.
function iosFixture(t, references, distinct = false) {
  const probe = spawnSync('ruby', ['-rxcodeproj', '-e', 'puts Xcodeproj::VERSION'], { encoding: 'utf8' });
  if (probe.error?.code === 'ENOENT' || /cannot load such file -- xcodeproj/.test(probe.stderr)) {
    t.skip('Ruby with xcodeproj is required for iOS resource integration');
    return null;
  }
  assert.equal(probe.status, 0, probe.stdout + probe.stderr);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cas-ios-resources-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  exportTemplate({ nativeStack: 'cas', out: root });
  const ios = path.join(root, 'ios/App');
  fs.mkdirSync(ios, { recursive: true });
  fs.writeFileSync(path.join(root, 'src/js/platform/config.js'),
    "export const APP_CONFIG = { ads: { cas: { ios: { casId: '123456' } } } };\n");
  const setup = spawnSync('ruby', ['-rxcodeproj', '-rjson', '-e', `
    project = Xcodeproj::Project.new('App.xcodeproj')
    target = project.new_target(:application, 'App', :ios, '15.0')
    group = project.main_group.new_group('App', 'App')
    Dir.mkdir('App')
    ${references}.times do |index|
      name = ${distinct} && index > 0 ? 'cas_settings_other.json' : 'cas_settings.json'
      target.add_resources([group.new_file(name)])
    end
    flags = ['-ObjC', '$(inherited)', '-weak_framework', 'SwiftUICore', '-framework', 'Existing']
    target.build_configurations.each { |config| config.build_settings['OTHER_LDFLAGS'] = flags }
    project.save
    gad = 'ca-app-pub-000000~111111'
    Xcodeproj::Plist.write_to_path({ 'CASAIAppIdentifier' => '123456',
      'GADApplicationIdentifier' => gad, 'SKAdNetworkItems' => [{'SKAdNetworkIdentifier' => 'test.skadnetwork'}] }, 'App/Info.plist')
    File.write('App/cas_settings.json', JSON.generate({'admob_app_id' => gad}))
  `], { cwd: ios, encoding: 'utf8' });
  assert.equal(setup.status, 0, setup.stdout + setup.stderr);
  const mock = path.join(root, 'vendor-update.cjs');
  // Mock only the external vendor update. Execute the actual exported wrapper
  // and its Ruby verification against a real Xcode project, including saves.
  fs.writeFileSync(mock, `const cp = require('node:child_process');
    const original = cp.execFileSync;
    cp.execFileSync = function(command, args, options) {
      if (command === 'ruby' && args[0] !== '-e') {
        return 'Config file is up-to-date\\nconfiguration script version 2.2\\n';
      }
      return original(command, args, options);
    };
    require('node:module').syncBuiltinESMExports();`);
  return {
    project: path.join(ios, 'App.xcodeproj/project.pbxproj'),
    prepare: () => spawnSync(process.execPath, ['scripts/prepare-cas-ios.mjs'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: `--require ${mock}` },
    }),
    inspect() {
      const result = spawnSync('ruby', ['-rxcodeproj', '-rjson', '-e', `
        project = Xcodeproj::Project.open('App.xcodeproj')
        target = project.targets.find { |item| item.name == 'App' }
        puts JSON.generate({ paths: target.resources_build_phase.files_references.map(&:path),
          flags: target.build_configurations.map { |item| item.build_settings['OTHER_LDFLAGS'] } })
      `], { cwd: ios, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      return JSON.parse(result.stdout);
    },
  };
}

for (const references of [1, 2, 3]) {
  test(`fresh CAS iOS preparation leaves one resource after ${references} same-path references and remains repeatable`, t => {
    const fixture = iosFixture(t, references);
    if (!fixture) return;
    const flags = fixture.inspect().flags;
    const result = fixture.prepare();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(fixture.inspect(), { paths: ['cas_settings.json'], flags });
    const before = fs.readFileSync(fixture.project);
    const repeat = fixture.prepare();
    assert.equal(repeat.status, 0, repeat.stdout + repeat.stderr);
    assert.deepEqual(fs.readFileSync(fixture.project), before);
  });
}

test('fresh CAS iOS preparation rejects distinct configuration resources without changing the project', t => {
  const fixture = iosFixture(t, 2, true);
  if (!fixture) return;
  const before = fs.readFileSync(fixture.project);
  const result = fixture.prepare();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /configuration resource missing or ambiguous/);
  assert.deepEqual(fs.readFileSync(fixture.project), before);
});
