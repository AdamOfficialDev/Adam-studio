// patch-fix.mjs — jalankan dengan: node patch-fix.mjs
import fs from 'node:fs';

const file = 'src/App.tsx';
let content = fs.readFileSync(file, 'utf8');

const oldBlockRegex = /<motion\.aside[\s\S]*?<ArtifactPanel[\s\S]*?\/>\s*<\/motion\.aside>/;
const fixedBlock = `<motion.aside
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.16 }}
                  className={cn(
                    'fixed inset-0 z-40 border-l lg:static',
                    artifactFullscreen ? 'lg:flex-1' : 'lg:shrink-0'
                  )}
                >
                  <div
                    style={
                      {
                        '--artifact-w': \`\${artifactWidthPct}vw\`,
                      } as CSSProperties
                    }
                    className={cn(
                      'h-full w-full',
                      !artifactFullscreen &&
                        'lg:w-[var(--artifact-w)] lg:min-w-[360px] lg:max-w-[68vw]'
                    )}
                  >
                    <ArtifactPanel
                      artifact={activeArtifact}
                      allArtifacts={conversationArtifacts}
                      isResizing={isResizingPane}
                      isFullscreen={artifactFullscreen}
                      onToggleFullscreen={() => setArtifactFullscreen((f) => !f)}
                      onSelectArtifact={setActiveArtifact}
                      onClose={() => {
                        setActiveArtifact(null);
                        setArtifactFullscreen(false);
                      }}
                    />
                  </div>
                </motion.aside>`;

if (!oldBlockRegex.test(content)) {
  console.error('✖ Blok target tidak ditemukan.');
  process.exit(1);
}

content = content.replace(oldBlockRegex, fixedBlock);
fs.writeFileSync(file, content, 'utf8');
console.log('✓ src/App.tsx berhasil diperbaiki!');