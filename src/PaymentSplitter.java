import java.util.*;
import java.util.stream.Collectors;

public class PaymentSplitter {

    private static class Person {
        String name;
        double balance = 0;

        public Person(String name) {
            this.name = name;
        }

        @Override
        public String toString() {
            return String.format("balance for %s is %.2f", name, balance);
        }
    }

    private static class People {
        Set<Person> people;

        public People(Person ... people) {
            this(new HashSet<>(Arrays.asList(people)));
        }

        public People(Set<Person> people) {
            this.people = people;
        }

        People except(Person ... peopleToExclude) {
            Set<Person> exceptionsSet = new HashSet<>(Arrays.asList(peopleToExclude));
            return new People(people.stream()
                    .filter(person -> !exceptionsSet.contains(person))
                    .collect(Collectors.toSet()));
        }

        @Override
        public String toString() {
            return people.stream()
                    .sorted(Comparator.comparingDouble(person -> person.balance))
                    .map(Person::toString)
                    .collect(Collectors.joining("\n"));
        }
    }

    private static class Expense {
        double amount;
        Person paidBy;
        People paidFor;

        public Expense(double amount, Person paidBy, People paidFor) {
            this.amount = amount;
            this.paidBy = paidBy;
            this.paidFor = paidFor;
        }
    }

    private static class Payment {
        double amount;
        Person from;
        Person to;

        public Payment(double amount, Person from, Person to) {
            this.amount = amount;
            this.from = from;
            this.to = to;
        }

        @Override
        public String toString() {
            return String.format("%s pays %.2f to %s", from.name, amount, to.name);
        }
    }

    private static class Trip {
        String placeTo;
        int year;
        People people;
        List<Expense> expenses;

        Set<Person> debtors = new HashSet<>();
        Set<Person> lenders = new HashSet<>();

        public Trip(String placeTo, int year, People people, List<Expense> expenses) {
            this.placeTo = placeTo;
            this.year = year;
            this.people = people;
            this.expenses = expenses;

            for (Expense expense : expenses) {
                expense.paidBy.balance += expense.amount;
                double perPersonAmount = expense.amount / expense.paidFor.people.size();
                expense.paidFor.people.forEach(person -> person.balance -= perPersonAmount);
            }

            for (Person person : people.people) {
                if (person.balance > 0) lenders.add(person);
                else debtors.add(person);
            }
        }

        public void printPayments() {
            System.out.printf("balances for %s %d before settling up:\n%s\n\n", placeTo, year, people.toString());
            List<Payment> payments = new ArrayList<>();
            for (Person debtor : debtors) {
                for (Person lender : lenders) {

                    // the max amount that can be paid is the min of what one person owes and the other is owed
                    double paymentAmount = Math.min(Math.abs(debtor.balance), Math.abs(lender.balance));
                    if (paymentAmount == 0) continue;

                    debtor.balance += paymentAmount;
                    lender.balance -= paymentAmount;
                    payments.add(new Payment(paymentAmount, debtor, lender));
                }
            }
            System.out.println("payments to settle up: ");
            payments.forEach(System.out::println);
            System.out.printf("\nbalances for %s %d after settling up:\n%s\n\n", placeTo, year, people.toString());
        }
    }

    private static final Person BEN = new Person("Ben");
    private static final Person ELLIOT = new Person("Elliot");
    private static final Person SLAVA = new Person("Slava");
    private static final Person DAN = new Person("Dan");
    private static final Person DAVE = new Person("Dave");
    private static final Person MATT = new Person("Matt");
    private static final Person GREG = new Person("Greg");
    private static final Person JASON = new Person("Jason");
    private static final Person EVAN = new Person("Evan");
    private static final Person JEFF = new Person("Jeff");

    private static final People ALL_SAVANNAH_PEOPLE = new People(BEN, ELLIOT, SLAVA, DAN, DAVE, MATT, GREG, JASON, EVAN, JEFF);
    private static final People BOSTON_JET_BLUE_CREW = new People(BEN, JASON, DAVE, MATT, EVAN, JEFF);
    private static final List<Expense> SAVANNAH_EXPENSES = List.of(
            new Expense(392.22, GREG, ALL_SAVANNAH_PEOPLE),

            new Expense(69.22, BEN, BOSTON_JET_BLUE_CREW),
            new Expense(280.95, BEN, BOSTON_JET_BLUE_CREW),
            new Expense(191.11, BEN, ALL_SAVANNAH_PEOPLE),
            new Expense(88.90, BEN, ALL_SAVANNAH_PEOPLE.except(DAVE)),
            new Expense(3000, BEN, ALL_SAVANNAH_PEOPLE),

            new Expense(14.51, EVAN, new People(DAN)),
            new Expense(50.95, EVAN, new People(JASON)),
            new Expense(58.43, EVAN, new People(ELLIOT)),
            new Expense(97.68 * 5, EVAN, new People(BEN, DAVE, MATT, GREG, JEFF)),
            new Expense(39, EVAN, ALL_SAVANNAH_PEOPLE),
            new Expense(209, EVAN, ALL_SAVANNAH_PEOPLE.except(SLAVA)),

            new Expense(281.32, MATT, BOSTON_JET_BLUE_CREW),
            new Expense(385.18, MATT, ALL_SAVANNAH_PEOPLE.except(EVAN)),
            new Expense(112.98, MATT, ALL_SAVANNAH_PEOPLE.except(EVAN, ELLIOT, DAN)),

            new Expense(360, DAVE, ALL_SAVANNAH_PEOPLE),
            new Expense(312.54, DAVE, ALL_SAVANNAH_PEOPLE.except(SLAVA)),
            new Expense(62.90, DAVE, new People(DAVE, JEFF, MATT)),
            new Expense(53, DAVE, new People(DAVE, MATT, DAN, ELLIOT)),
            new Expense(41, DAVE, ALL_SAVANNAH_PEOPLE.except(EVAN, DAN, ELLIOT)),

            new Expense(110.99, JEFF, ALL_SAVANNAH_PEOPLE),
            new Expense(139, JEFF, ALL_SAVANNAH_PEOPLE),
            new Expense(183, JEFF, new People(MATT, DAVE, BEN, JEFF)),

            new Expense(85, DAN, ALL_SAVANNAH_PEOPLE.except(SLAVA))
    );

    private static final Trip SAVANNAH = new Trip("Savannah", 2022, ALL_SAVANNAH_PEOPLE, SAVANNAH_EXPENSES);

    public static void main(String[] args) {
        SAVANNAH.printPayments();
    }
}
