import { Faker, allFakers, en } from "@faker-js/faker";
import type { ElementCandidate } from "./frontier.js";

export interface FieldValueGenerator {
  /** Testado contra o nome acessivel/label do campo. */
  pattern: RegExp;
  generate: (faker: Faker) => string;
}

/**
 * Lookup table de inferencia de tipo de campo por label/nome acessivel
 * (secao C do plano). Checada em ordem - a primeira que casar vence.
 * CPF/CNPJ nao tem gerador default aqui de proposito: precisa de digito
 * verificador valido, o que e especifico demais para uma default generica -
 * ver `FakerFillOptions.extraGenerators` para injetar um gerador por site.
 */
const DEFAULT_GENERATORS: FieldValueGenerator[] = [
  { pattern: /e-?mail/i, generate: (faker) => faker.internet.email() },
  { pattern: /telefone|celular|\bphone\b/i, generate: (faker) => faker.phone.number() },
  { pattern: /\bcep\b|zip|postal/i, generate: (faker) => faker.location.zipCode() },
  { pattern: /senha|password/i, generate: (faker) => faker.internet.password({ length: 12 }) },
  { pattern: /\bdata\b|\bdate\b/i, generate: (faker) => faker.date.recent().toISOString().slice(0, 10) },
  { pattern: /\bnome\b|\bname\b/i, generate: (faker) => faker.person.fullName() },
  { pattern: /cidade|\bcity\b/i, generate: (faker) => faker.location.city() },
  { pattern: /endere[cç]o|address/i, generate: (faker) => faker.location.streetAddress() },
  { pattern: /telefone|whats ?app/i, generate: (faker) => faker.phone.number() },
  { pattern: /empresa|company/i, generate: (faker) => faker.company.name() },
  { pattern: /usu[aá]rio|username/i, generate: (faker) => faker.internet.username() },
  { pattern: /\bidade\b|\bage\b/i, generate: (faker) => String(faker.number.int({ min: 18, max: 80 })) },
];

export interface FakerFillOptions {
  locale?: string;
  /** Geradores especificos do site, checados ANTES dos defaults (ex: CPF/CNPJ com digito verificador). */
  extraGenerators?: readonly FieldValueGenerator[];
}

function resolveFaker(locale?: string): Faker {
  if (!locale) return allFakers.en;
  const key = locale.replace("-", "_") as keyof typeof allFakers;
  return allFakers[key] ?? allFakers.en ?? new Faker({ locale: [en] });
}

/** Gera um valor sintetico para um campo de formulario com base no seu nome acessivel/label. */
export function generateFieldValue(candidate: ElementCandidate, options: FakerFillOptions = {}): string {
  const faker = resolveFaker(options.locale);
  const generators = [...(options.extraGenerators ?? []), ...DEFAULT_GENERATORS];
  for (const generator of generators) {
    if (generator.pattern.test(candidate.name)) {
      return generator.generate(faker);
    }
  }
  return faker.lorem.words(3);
}
