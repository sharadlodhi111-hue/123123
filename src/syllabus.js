// Editable syllabus seed for CBSE Class X, 2026–27. Source: cbseacademic.nic.in/curriculum_2027.html
// Chapters are study-planning buckets. Topics marked formativeOnly are not year-end assessed.
export const SUBJECTS = [
  { name: 'Science', color: 'green', groups: {
    Physics: ['Light: Reflection and Refraction', 'The Human Eye and the Colourful World', 'Electricity', 'Magnetic Effects of Electric Current'],
    Chemistry: ['Chemical Reactions and Equations', 'Acids, Bases and Salts', 'Metals and Non-metals', 'Carbon and its Compounds', { name: 'Periodic Classification of Elements', formativeOnly: true }],
    Biology: ['Life Processes', 'Control and Coordination', 'How do Organisms Reproduce?', { name: 'Heredity', formativeOnly: true }, { name: 'Evolution', formativeOnly: true }, 'Our Environment']
  }}
];
export const chapterList = SUBJECTS.flatMap(subject => {
  const groups = subject.groups || { [subject.name]: subject.chapters };
  return Object.entries(groups).flatMap(([group, chapters]) => chapters.map((item, index) => ({
    id: `${subject.name}-${group}-${index}`,
    subject: subject.name,
    group,
    name: typeof item === 'string' ? item : item.name,
    formativeOnly: typeof item === 'object' && !!item.formativeOnly,
    scopeNote: typeof item === 'object' ? item.note : '',
    difficulty: index % 4 === 1 ? 3 : index % 3 === 0 ? 2 : 1
  })));
});

export const STATUS = ['not-started', 'partial', 'completed'];
export const statusLabel = { 'not-started': 'Not started', partial: 'Partially completed', completed: 'Completed' };
