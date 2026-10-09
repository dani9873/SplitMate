Pod::Spec.new do |s|
  s.name           = 'SplitmateBackup'
  s.version        = '1.0.0'
  s.summary        = 'Excluye la base local de SplitMate del respaldo de iOS'
  s.description    = 'Marca archivos y carpetas con isExcludedFromBackup.'
  s.license        = 'UNLICENSED'
  s.author         = 'SplitMate'
  s.homepage       = 'https://github.com/dani9873/SplitMate'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/dani9873/SplitMate.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
